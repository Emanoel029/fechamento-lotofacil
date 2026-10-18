"""Servidor local do Fechamento Lotofácil.

Busca resultados oficiais da Lotofácil na API pública da Caixa, gera 24
jogos de 15 números a partir de 7 números excluídos pelo usuário, e compara
esses jogos com o resultado real de um concurso.

Usa só a biblioteca padrão do Python (não precisa instalar nada).
"""
from __future__ import annotations

import csv
import io
import json
import mimetypes
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

CAIXA_BASE = "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil"
# Espelhos públicos com os mesmos dados da Caixa — usados como reserva quando o site oficial
# bloqueia o pedido (acontece em alguns servidores de hospedagem na nuvem).
CAIXA_BASE_RESERVA = "https://api.guidi.dev.br/loteria/lotofacil"
HEROKU_BASE_RESERVA = "https://loteriascaixa-api.herokuapp.com/api/lotofacil"
TODOS_OS_NUMEROS = list(range(1, 26))
EXCLUIDOS_PELO_USUARIO = 7
TOTAL_DE_JOGOS = 24
EXCLUIDOS_POR_JOGO = 3  # 18 (pool) - 15 (tamanho do jogo)
QUANTIDADES_HISTORICO_VALIDAS = (10, 20, 30, 40, 50, 100)

STATIC_DIR = Path(__file__).parent / "static"
DADOS_DIR = Path(__file__).parent / "dados"
ARQUIVO_SALVOS = DADOS_DIR / "jogos_salvos.json"
ARQUIVO_HISTORICO = DADOS_DIR / "historico_concursos.json"
TRAVA_SALVOS = threading.Lock()
TRAVA_HISTORICO = threading.Lock()


def _ler_salvos() -> list[dict]:
    if not ARQUIVO_SALVOS.exists():
        return []
    try:
        return json.loads(ARQUIVO_SALVOS.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def _gravar_salvos(registros: list[dict]) -> None:
    DADOS_DIR.mkdir(exist_ok=True)
    ARQUIVO_SALVOS.write_text(json.dumps(registros, ensure_ascii=False, indent=2), encoding="utf-8")


def salvar_jogo(
    dados_concurso: dict, excluidos: list[int], jogos: list[list[int]], comparacao: dict | None
) -> dict:
    registro = {
        "id": uuid.uuid4().hex[:8],
        "criadoEm": datetime.now(timezone.utc).isoformat(),
        "concurso": dados_concurso,
        "excluidos": sorted(excluidos),
        "jogos": jogos,
        "comparacao": comparacao,
    }
    with TRAVA_SALVOS:
        registros = _ler_salvos()
        registros.insert(0, registro)
        _gravar_salvos(registros)
    return registro


def listar_salvos() -> list[dict]:
    with TRAVA_SALVOS:
        registros = _ler_salvos()
    resumo = []
    for r in registros:
        comparacao = r.get("comparacao")
        resumo.append({
            "id": r["id"],
            "criadoEm": r["criadoEm"],
            "concurso": r["concurso"]["concurso"],
            "data": r["concurso"].get("data"),
            "excluidos": r["excluidos"],
            "aindaNaoSorteado": comparacao is None,
            "totalJogosPremiados": comparacao["totalJogosPremiados"] if comparacao else None,
            "valorTotal": comparacao["valorTotal"] if comparacao else None,
        })
    return resumo


def buscar_salvo(id_registro: str) -> dict | None:
    with TRAVA_SALVOS:
        registros = _ler_salvos()
    return next((r for r in registros if r["id"] == id_registro), None)


def excluir_salvo(id_registro: str) -> bool:
    with TRAVA_SALVOS:
        registros = _ler_salvos()
        restantes = [r for r in registros if r["id"] != id_registro]
        encontrado = len(restantes) != len(registros)
        if encontrado:
            _gravar_salvos(restantes)
    return encontrado


def atualizar_salvo(registro_atualizado: dict) -> None:
    with TRAVA_SALVOS:
        registros = _ler_salvos()
        for indice, registro in enumerate(registros):
            if registro["id"] == registro_atualizado["id"]:
                registros[indice] = registro_atualizado
                break
        _gravar_salvos(registros)


def gerar_csv_jogos(dados_concurso: dict, excluidos: list[int], jogos: list[list[int]]) -> bytes:
    buffer = io.StringIO()
    escritor = csv.writer(buffer, delimiter=";")
    escritor.writerow([f"Concurso {dados_concurso['concurso']} - {dados_concurso.get('data', '')}"])
    escritor.writerow(["Números excluídos:", *[f"{n:02d}" for n in sorted(excluidos)]])
    escritor.writerow([])
    escritor.writerow(["Aposta", *[f"Dezena {i + 1}" for i in range(15)]])
    for indice, jogo in enumerate(jogos, start=1):
        escritor.writerow([indice, *[f"{n:02d}" for n in jogo]])
    # BOM no início para o Excel reconhecer acentuação em UTF-8 corretamente
    return ("﻿" + buffer.getvalue()).encode("utf-8")


class ErroDeBusca(Exception):
    def __init__(self, mensagem: str, status: int = 502):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status


_CABECALHOS_CAIXA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://loterias.caixa.gov.br/",
    "Origin": "https://loterias.caixa.gov.br",
}


def _requisitar_json(url: str) -> dict:
    requisicao = urllib.request.Request(url, headers=_CABECALHOS_CAIXA)
    with urllib.request.urlopen(requisicao, timeout=15) as resposta:
        return json.loads(resposta.read())


def _normalizar_formato_oficial(bruto: dict) -> dict:
    """A Caixa e o espelho guidi.dev.br usam exatamente o mesmo formato."""
    return {
        "numero": bruto["numero"],
        "dataApuracao": bruto.get("dataApuracao"),
        "listaDezenas": bruto["listaDezenas"],
        "listaRateioPremio": bruto.get("listaRateioPremio", []),
        "numeroConcursoProximo": bruto.get("numeroConcursoProximo"),
        "dataProximoConcurso": bruto.get("dataProximoConcurso"),
        "valorEstimadoProximoConcurso": bruto.get("valorEstimadoProximoConcurso", 0),
    }


def _normalizar_formato_heroku(bruto: dict) -> dict:
    """O espelho no Heroku usa nomes de campo diferentes — traduz pro formato padrão."""
    premios = [
        {
            "descricaoFaixa": premio.get("descricao"),
            "valorPremio": premio.get("valorPremio", 0),
            "numeroDeGanhadores": premio.get("ganhadores", 0),
        }
        for premio in bruto.get("premiacoes", [])
    ]
    return {
        "numero": bruto["concurso"],
        "dataApuracao": bruto.get("data"),
        "listaDezenas": bruto["dezenas"],
        "listaRateioPremio": premios,
        "numeroConcursoProximo": bruto.get("proximoConcurso"),
        "dataProximoConcurso": bruto.get("dataProximoConcurso"),
        "valorEstimadoProximoConcurso": bruto.get("valorEstimadoProximoConcurso", 0),
    }


# Tenta sempre o site oficial primeiro; se ele bloquear o pedido (acontece em alguns
# servidores de hospedagem na nuvem), tenta os espelhos na ordem abaixo.
GITHUB_RAW_ESPELHO = (
    "https://raw.githubusercontent.com/Emanoel029/fechamento-lotofacil/main/espelho/ultimo_resultado.json"
)

_FONTES_DE_DADOS = [
    {
        # Arquivo que um robô do GitHub atualiza sozinho a cada ~20 minutos, buscando
        # direto da Caixa — não sofre o bloqueio que alguns servidores de hospedagem
        # tomam, porque aqui só estamos lendo um arquivo público, não fazendo a busca.
        "nome": "espelho (GitHub, atualizado automaticamente)",
        # O "?v=" com a hora atual evita que esse link sirva uma cópia em cache (o
        # raw.githubusercontent.com guarda cache por alguns minutos por padrão).
        "url": lambda numero: f"{GITHUB_RAW_ESPELHO}?v={int(time.time())}",
        "normalizar": _normalizar_formato_oficial,
    },
    {
        "nome": "oficial",
        "url": lambda numero: CAIXA_BASE if numero is None else f"{CAIXA_BASE}/{numero}",
        "normalizar": _normalizar_formato_oficial,
    },
    {
        "nome": "espelho (guidi.dev.br)",
        "url": lambda numero: f"{CAIXA_BASE_RESERVA}/ultimo" if numero is None else f"{CAIXA_BASE_RESERVA}/{numero}",
        "normalizar": _normalizar_formato_oficial,
    },
    {
        "nome": "espelho (heroku)",
        "url": lambda numero: f"{HEROKU_BASE_RESERVA}/latest" if numero is None else f"{HEROKU_BASE_RESERVA}/{numero}",
        "normalizar": _normalizar_formato_heroku,
    },
]


def _buscar_dados_brutos_na_caixa(numero: int | None) -> dict:
    # Importante: uma fonte (espelho) pode responder 404 pra um concurso bem recente só
    # porque ela ainda não atualizou — não é prova de que o concurso não existe. Por isso,
    # NUNCA paramos no primeiro 404: sempre tentamos todas as fontes antes de desistir.
    # (O espelho do GitHub só guarda o concurso mais recente — se o número pedido for
    # outro, não vale como resposta pra essa busca específica, só pula pra próxima fonte.)
    candidatos: list[dict] = []
    ultimo_erro: Exception | None = None

    for fonte in _FONTES_DE_DADOS:
        try:
            bruto = _requisitar_json(fonte["url"](numero))
            normalizado = fonte["normalizar"](bruto)
            if numero is not None:
                if normalizado["numero"] != numero:
                    continue
                return normalizado
            candidatos.append(normalizado)
        except urllib.error.HTTPError as erro:
            ultimo_erro = erro
        except (urllib.error.URLError, TimeoutError, KeyError) as erro:
            ultimo_erro = erro

    if candidatos:
        # "Mais recente": usa o maior número de concurso entre as fontes que responderam,
        # pra não ficar preso numa fonte desatualizada enquanto outra já tem o resultado novo.
        return max(candidatos, key=lambda d: d["numero"])

    if isinstance(ultimo_erro, urllib.error.HTTPError) and ultimo_erro.code in (404, 500):
        raise ErroDeBusca("Concurso não encontrado ou ainda não sorteado.", 404)
    if isinstance(ultimo_erro, urllib.error.HTTPError):
        raise ErroDeBusca(f"Não consegui buscar esse concurso agora (erro {ultimo_erro.code}).")
    raise ErroDeBusca(f"Não consegui buscar esse concurso agora: {ultimo_erro}")


def buscar_concurso_na_caixa(numero: int | None) -> dict:
    dados = _buscar_dados_brutos_na_caixa(numero)

    if "listaDezenas" not in dados:
        raise ErroDeBusca("Concurso não encontrado ou ainda não sorteado.", 404)

    sorteados = sorted(int(n) for n in dados["listaDezenas"])
    ausentes = sorted(set(TODOS_OS_NUMEROS) - set(sorteados))

    premios: dict[int, dict] = {}
    for faixa in dados.get("listaRateioPremio", []):
        pontos = _pontos_da_descricao(faixa.get("descricaoFaixa", ""))
        if pontos is not None:
            premios[pontos] = {
                "valorPremio": faixa.get("valorPremio", 0) or 0,
                "numeroDeGanhadores": faixa.get("numeroDeGanhadores", 0) or 0,
            }

    return {
        "concurso": dados["numero"],
        "data": dados.get("dataApuracao"),
        "sorteados": sorteados,
        "ausentes": ausentes,
        "premios": premios,
    }


def buscar_proximo_concurso() -> dict:
    dados = _buscar_dados_brutos_na_caixa(None)
    return {
        "concurso": dados.get("numeroConcursoProximo"),
        "data": dados.get("dataProximoConcurso"),
        "valorEstimado": dados.get("valorEstimadoProximoConcurso", 0) or 0,
    }


def _ler_cache_historico() -> dict[str, dict]:
    if not ARQUIVO_HISTORICO.exists():
        return {}
    try:
        return json.loads(ARQUIVO_HISTORICO.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _gravar_cache_historico(cache: dict[str, dict]) -> None:
    DADOS_DIR.mkdir(exist_ok=True)
    ARQUIVO_HISTORICO.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def obter_concurso_cacheado(numero: int) -> dict | None:
    """Pega um concurso do cache local; se não tiver, busca na Caixa e guarda pra
    próxima vez (resultado de concurso passado nunca muda)."""
    chave = str(numero)
    with TRAVA_HISTORICO:
        cache = _ler_cache_historico()
        if chave in cache:
            return cache[chave]

    try:
        dados = buscar_concurso_na_caixa(numero)
    except ErroDeBusca:
        return None

    resumo = {"concurso": dados["concurso"], "data": dados["data"], "sorteados": dados["sorteados"]}
    with TRAVA_HISTORICO:
        cache = _ler_cache_historico()
        cache[chave] = resumo
        _gravar_cache_historico(cache)
    return resumo


def montar_historico(quantidade: int) -> dict:
    ultimo_sorteado = buscar_concurso_na_caixa(None)["concurso"]
    primeiro = max(1, ultimo_sorteado - quantidade + 1)
    numeros = list(range(primeiro, ultimo_sorteado + 1))

    with ThreadPoolExecutor(max_workers=8) as executor:
        resultados = list(executor.map(obter_concurso_cacheado, numeros))
    por_numero = {numero: resultado for numero, resultado in zip(numeros, resultados) if resultado}

    numeros_ordenados = sorted(por_numero)  # mais antigo -> mais recente
    linhas = []
    for numero in numeros_ordenados:
        concurso = por_numero[numero]
        sorteados = set(concurso["sorteados"])
        ausentes = set(TODOS_OS_NUMEROS) - sorteados
        pares = sum(1 for n in sorteados if n % 2 == 0)
        impares = 15 - pares
        pares_ausentes = sum(1 for n in ausentes if n % 2 == 0)
        impares_ausentes = 10 - pares_ausentes

        anterior = por_numero.get(numero - 1)
        if anterior:
            sorteados_anterior = set(anterior["sorteados"])
            ausentes_anterior = set(TODOS_OS_NUMEROS) - sorteados_anterior
            repetentes = len(sorteados & sorteados_anterior)
            repetentes_ausentes = len(ausentes & ausentes_anterior)
        else:
            repetentes = None
            repetentes_ausentes = None

        linhas.append({
            "concurso": concurso["concurso"],
            "data": concurso["data"],
            "sorteados": sorted(sorteados),
            "ausentes": sorted(ausentes),
            "repetentes": repetentes,
            "pares": pares,
            "impares": impares,
            "repetentesAusentes": repetentes_ausentes,
            "paresAusentes": pares_ausentes,
            "imparesAusentes": impares_ausentes,
        })

    linhas.reverse()  # mais recente primeiro, pra exibição

    def montar_frequencias(chave: str) -> list[dict]:
        contagem = {n: 0 for n in TODOS_OS_NUMEROS}
        for linha in linhas:
            for n in linha[chave]:
                contagem[n] += 1
        return [
            {"numero": numero, "quantidade": quantidade}
            for numero, quantidade in sorted(contagem.items(), key=lambda item: (-item[1], item[0]))
        ]

    def media(valores):
        return round(sum(valores) / len(valores), 2) if valores else None

    repetentes_validos = [linha["repetentes"] for linha in linhas if linha["repetentes"] is not None]
    pares_totais = [linha["pares"] for linha in linhas]
    impares_totais = [linha["impares"] for linha in linhas]

    repetentes_ausentes_validos = [
        linha["repetentesAusentes"] for linha in linhas if linha["repetentesAusentes"] is not None
    ]
    pares_ausentes_totais = [linha["paresAusentes"] for linha in linhas]
    impares_ausentes_totais = [linha["imparesAusentes"] for linha in linhas]

    return {
        "quantidade": quantidade,
        "linhas": linhas,
        "frequencias": montar_frequencias("sorteados"),
        "mediaRepetentes": media(repetentes_validos),
        "mediaPares": media(pares_totais),
        "mediaImpares": media(impares_totais),
        "somaPares": sum(pares_totais),
        "somaImpares": sum(impares_totais),
        "frequenciasAusentes": montar_frequencias("ausentes"),
        "mediaRepetentesAusentes": media(repetentes_ausentes_validos),
        "mediaParesAusentes": media(pares_ausentes_totais),
        "mediaImparesAusentes": media(impares_ausentes_totais),
        "somaParesAusentes": sum(pares_ausentes_totais),
        "somaImparesAusentes": sum(impares_ausentes_totais),
    }


def _pontos_da_descricao(descricao: str) -> int | None:
    partes = descricao.strip().split()
    if partes and partes[0].isdigit():
        return int(partes[0])
    return None


def gerar_24_jogos(pool: list[int]) -> list[list[int]]:
    """Gera 24 jogos de 15 números a partir de um pool de 18 números.

    Cada um dos 18 números fica de fora em exatamente 4 dos 24 jogos: o pool
    é embaralhado de 4 jeitos diferentes (determinísticos) e, em cada um
    deles, dividido em 6 grupos de 3 números que ficam de fora juntos em um
    jogo cada — isso cobre cada número exatamente uma vez por rodada, e 4
    rodadas de 6 jogos dão os 24 jogos no total.
    """
    pool = sorted(pool)
    tamanho = len(pool)
    passos = [1, 5, 7, 11]  # coprimos com 18: garantem reembaralhar o pool inteiro

    jogos: list[list[int]] = []
    jogos_vistos: set[frozenset[int]] = set()

    for rodada, passo in enumerate(passos):
        deslocamento = rodada * 3
        ordem = [pool[(i * passo + deslocamento) % tamanho] for i in range(tamanho)]
        for inicio in range(0, tamanho, EXCLUIDOS_POR_JOGO):
            excluidos_do_jogo = frozenset(ordem[inicio: inicio + EXCLUIDOS_POR_JOGO])
            jogo = sorted(set(pool) - excluidos_do_jogo)
            chave = frozenset(jogo)
            if chave in jogos_vistos:
                continue
            jogos_vistos.add(chave)
            jogos.append(jogo)

    return jogos[:TOTAL_DE_JOGOS]


def comparar_jogos(jogos: list[list[int]], sorteados: list[int], premios: dict) -> dict:
    sorteados_set = set(sorteados)
    por_faixa = {pontos: 0 for pontos in range(11, 16)}

    for jogo in jogos:
        pontos = len(set(jogo) & sorteados_set)
        if pontos in por_faixa:
            por_faixa[pontos] += 1

    linhas = []
    valor_total = 0.0
    total_premiados = 0
    for pontos in range(15, 10, -1):
        quantidade = por_faixa[pontos]
        valor_unitario = premios.get(pontos, {}).get("valorPremio", 0) or 0
        valor_faixa = quantidade * valor_unitario
        valor_total += valor_faixa
        total_premiados += quantidade
        linhas.append({
            "pontos": pontos,
            "quantidade": quantidade,
            "valorUnitario": valor_unitario,
            "valorFaixa": round(valor_faixa, 2),
        })

    return {
        "linhas": linhas,
        "totalJogosPremiados": total_premiados,
        "valorTotal": round(valor_total, 2),
    }


def _tentar_atualizar_comparacao(registro: dict) -> dict:
    """Se um jogo salvo ainda não tem comparação (foi gerado pro 'próximo concurso'),
    tenta buscar o resultado real agora — se o sorteio já aconteceu, calcula a
    comparação e grava no registro salvo, pra não precisar buscar de novo depois."""
    if registro.get("comparacao") is not None:
        return registro

    numero = registro["concurso"]["concurso"]
    try:
        dados_concurso = buscar_concurso_na_caixa(numero)
    except ErroDeBusca:
        return registro

    comparacao = comparar_jogos(registro["jogos"], dados_concurso["sorteados"], dados_concurso["premios"])
    registro = {**registro, "concurso": dados_concurso, "comparacao": comparacao}
    atualizar_salvo(registro)
    return registro


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # silencia log padrão barulhento
        pass

    def _enviar_json(self, payload: dict, status: int = 200):
        corpo = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _enviar_arquivo_estatico(self, caminho: Path):
        tipo, _ = mimetypes.guess_type(str(caminho))
        conteudo = caminho.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", tipo or "application/octet-stream")
        self.send_header("Content-Length", str(len(conteudo)))
        self.end_headers()
        self.wfile.write(conteudo)

    def _enviar_csv(self, nome_arquivo: str, conteudo: bytes):
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{nome_arquivo}"')
        self.send_header("Content-Length", str(len(conteudo)))
        self.end_headers()
        self.wfile.write(conteudo)

    def do_GET(self):
        url = urlparse(self.path)
        partes = [p for p in url.path.split("/") if p]

        if url.path == "/" or url.path == "":
            self._enviar_arquivo_estatico(STATIC_DIR / "index.html")
            return

        if url.path == "/api/concurso":
            query = parse_qs(url.query)
            numero_str = query.get("numero", [None])[0]
            numero = int(numero_str) if numero_str else None
            try:
                dados = buscar_concurso_na_caixa(numero)
            except ErroDeBusca as erro:
                self._enviar_json({"erro": erro.mensagem}, erro.status)
                return
            self._enviar_json(dados)
            return

        if url.path == "/api/proximo-concurso":
            try:
                dados = buscar_proximo_concurso()
            except ErroDeBusca as erro:
                self._enviar_json({"erro": erro.mensagem}, erro.status)
                return
            self._enviar_json(dados)
            return

        if url.path == "/api/historico":
            query = parse_qs(url.query)
            try:
                quantidade = int(query.get("quantidade", [10])[0])
            except ValueError:
                quantidade = 10
            if quantidade not in QUANTIDADES_HISTORICO_VALIDAS:
                self._enviar_json({"erro": "Quantidade inválida."}, 400)
                return
            try:
                dados = montar_historico(quantidade)
            except ErroDeBusca as erro:
                self._enviar_json({"erro": erro.mensagem}, erro.status)
                return
            self._enviar_json(dados)
            return

        if partes == ["api", "salvos"]:
            self._enviar_json({"salvos": listar_salvos()})
            return

        if len(partes) == 3 and partes[:2] == ["api", "salvos"]:
            registro = buscar_salvo(partes[2])
            if registro is None:
                self._enviar_json({"erro": "Jogo salvo não encontrado."}, 404)
                return
            registro = _tentar_atualizar_comparacao(registro)
            self._enviar_json(registro)
            return

        if len(partes) == 4 and partes[:2] == ["api", "salvos"] and partes[3] == "exportar":
            registro = buscar_salvo(partes[2])
            if registro is None:
                self._enviar_json({"erro": "Jogo salvo não encontrado."}, 404)
                return
            csv_bytes = gerar_csv_jogos(registro["concurso"], registro["excluidos"], registro["jogos"])
            self._enviar_csv(f"lotofacil-concurso-{registro['concurso']['concurso']}.csv", csv_bytes)
            return

        candidato = (STATIC_DIR / url.path.lstrip("/")).resolve()
        if STATIC_DIR in candidato.parents and candidato.is_file():
            self._enviar_arquivo_estatico(candidato)
            return

        self._enviar_json({"erro": "Não encontrado."}, 404)

    def do_DELETE(self):
        url = urlparse(self.path)
        partes = [p for p in url.path.split("/") if p]

        if len(partes) == 3 and partes[:2] == ["api", "salvos"]:
            removido = excluir_salvo(partes[2])
            if not removido:
                self._enviar_json({"erro": "Jogo salvo não encontrado."}, 404)
                return
            self._enviar_json({"ok": True})
            return

        self._enviar_json({"erro": "Não encontrado."}, 404)

    def _ler_corpo_json(self) -> dict | None:
        tamanho = int(self.headers.get("Content-Length", 0))
        try:
            return json.loads(self.rfile.read(tamanho) or b"{}")
        except json.JSONDecodeError:
            return None

    def do_POST(self):
        url = urlparse(self.path)

        if url.path == "/api/gerar":
            self._rota_gerar()
            return

        if url.path == "/api/salvar":
            self._rota_salvar()
            return

        if url.path == "/api/exportar":
            self._rota_exportar_avulso()
            return

        self._enviar_json({"erro": "Não encontrado."}, 404)

    def _validar_excluidos(self, corpo: dict) -> set[int] | None:
        excluidos = corpo.get("excluidos", [])
        if not isinstance(excluidos, list) or len(excluidos) != EXCLUIDOS_PELO_USUARIO:
            self._enviar_json(
                {"erro": f"Selecione exatamente {EXCLUIDOS_PELO_USUARIO} números."}, 400
            )
            return None
        try:
            excluidos_set = {int(n) for n in excluidos}
        except (TypeError, ValueError):
            self._enviar_json({"erro": "Número inválido entre os excluídos."}, 400)
            return None
        if not excluidos_set.issubset(set(TODOS_OS_NUMEROS)):
            self._enviar_json({"erro": "Número inválido entre os excluídos."}, 400)
            return None
        return excluidos_set

    def _rota_gerar(self):
        corpo = self._ler_corpo_json()
        if corpo is None:
            self._enviar_json({"erro": "Requisição inválida."}, 400)
            return

        excluidos_set = self._validar_excluidos(corpo)
        if excluidos_set is None:
            return

        pool = sorted(set(TODOS_OS_NUMEROS) - excluidos_set)
        jogos = gerar_24_jogos(pool)

        if corpo.get("modoProximo"):
            try:
                proximo = buscar_proximo_concurso()
            except ErroDeBusca as erro:
                self._enviar_json({"erro": erro.mensagem}, erro.status)
                return
            dados_concurso = {
                "concurso": proximo["concurso"],
                "data": proximo["data"],
                "sorteados": None,
                "ausentes": None,
                "premios": None,
            }
            self._enviar_json({"concurso": dados_concurso, "jogos": jogos, "comparacao": None})
            return

        try:
            dados_concurso = buscar_concurso_na_caixa(corpo.get("concurso"))
        except ErroDeBusca as erro:
            self._enviar_json({"erro": erro.mensagem}, erro.status)
            return

        comparacao = comparar_jogos(jogos, dados_concurso["sorteados"], dados_concurso["premios"])

        self._enviar_json({
            "concurso": dados_concurso,
            "jogos": jogos,
            "comparacao": comparacao,
        })

    def _rota_salvar(self):
        corpo = self._ler_corpo_json()
        if corpo is None:
            self._enviar_json({"erro": "Requisição inválida."}, 400)
            return

        dados_concurso = corpo.get("concurso")
        excluidos = corpo.get("excluidos")
        jogos = corpo.get("jogos")
        comparacao = corpo.get("comparacao")  # pode ser None (jogo pro próximo concurso)
        if not all([dados_concurso, excluidos, jogos]):
            self._enviar_json({"erro": "Dados incompletos para salvar."}, 400)
            return

        registro = salvar_jogo(dados_concurso, excluidos, jogos, comparacao)
        self._enviar_json({"id": registro["id"]})

    def _rota_exportar_avulso(self):
        corpo = self._ler_corpo_json()
        if corpo is None:
            self._enviar_json({"erro": "Requisição inválida."}, 400)
            return

        dados_concurso = corpo.get("concurso")
        excluidos = corpo.get("excluidos")
        jogos = corpo.get("jogos")
        if not all([dados_concurso, excluidos, jogos]):
            self._enviar_json({"erro": "Dados incompletos para exportar."}, 400)
            return

        csv_bytes = gerar_csv_jogos(dados_concurso, excluidos, jogos)
        self._enviar_csv(f"lotofacil-concurso-{dados_concurso['concurso']}.csv", csv_bytes)


def main():
    # Em produção (Render, etc.) a porta vem da variável de ambiente PORT.
    # Aqui na máquina local, sem essa variável, continua usando a 5057 de sempre.
    porta = int(os.environ.get("PORT", 5057))
    servidor = ThreadingHTTPServer(("0.0.0.0", porta), Handler)
    print(f"Servidor rodando na porta {porta}")
    servidor.serve_forever()


if __name__ == "__main__":
    main()
