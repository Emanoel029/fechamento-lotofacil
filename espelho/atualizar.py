"""Busca o concurso mais recente da Lotofácil e grava em espelho/ultimo_resultado.json.

Rodado pelo workflow .github/workflows/atualizar-resultado.yml a cada ~20 minutos.

Duas proteções contra ficar desatualizado:
1. Consulta duas fontes (site oficial da Caixa e o espelho guidi.dev.br) e usa a que
   tiver o número de concurso mais alto — uma pode demorar mais que a outra pra
   "virar a chave" pro resultado novo.
2. Mesmo assim, às vezes as duas fontes "atrasam" exatamente ao mesmo tempo (porque
   ambas refletem o mesmo indicador de "mais recente" da Caixa, que demora um pouco
   pra atualizar após cada sorteio). Por isso, depois de escolher a melhor candidata,
   tenta também buscar o PRÓXIMO número de concurso diretamente (não pelo indicador de
   "mais recente", e sim pedindo esse número específico) — se ele já existir de
   verdade, usa esse em vez do indicador desatualizado. Repete até não achar mais
   nenhum concurso novo.
"""
import json
import urllib.request

CAIXA_BASE = "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil"
GUIDI_BASE = "https://api.guidi.dev.br/loteria/lotofacil"

FONTES_MAIS_RECENTE = {
    "oficial": CAIXA_BASE,
    "guidi": f"{GUIDI_BASE}/ultimo",
}

CABECALHOS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
}


def buscar(url: str) -> dict:
    try:
        requisicao = urllib.request.Request(url, headers=CABECALHOS)
        with urllib.request.urlopen(requisicao, timeout=15) as resposta:
            return json.loads(resposta.read())
    except Exception as erro:  # noqa: BLE001 - qualquer falha aqui só faz essa fonte não contar
        print(f"Falha buscando {url}: {erro}")
        return {}


def buscar_concurso_especifico(numero: int) -> dict:
    for base in (CAIXA_BASE, GUIDI_BASE):
        dados = buscar(f"{base}/{numero}")
        if dados.get("numero") == numero:
            return dados
    return {}


def main() -> None:
    candidatos = [buscar(url) for url in FONTES_MAIS_RECENTE.values()]
    candidatos = [dados for dados in candidatos if dados.get("numero")]
    if not candidatos:
        raise SystemExit("Nenhuma das fontes respondeu com um concurso válido.")

    mais_novo = max(candidatos, key=lambda dados: dados["numero"])

    # Confere diretamente se já existe um concurso mais novo ainda (protege contra as
    # duas fontes de "mais recente" estarem atrasadas ao mesmo tempo).
    for _ in range(5):  # limite de segurança, nunca deveria passar de 1-2 voltas
        proximo_numero = mais_novo["numero"] + 1
        proximo = buscar_concurso_especifico(proximo_numero)
        if not proximo:
            break
        mais_novo = proximo

    with open("espelho/ultimo_resultado.json", "w", encoding="utf-8") as arquivo:
        json.dump(mais_novo, arquivo, ensure_ascii=False)
    print(f"Usando concurso {mais_novo['numero']} (data {mais_novo.get('dataApuracao')}).")


if __name__ == "__main__":
    main()
