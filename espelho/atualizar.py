"""Busca o concurso mais recente da Lotofácil em duas fontes (site oficial da Caixa e o
espelho guidi.dev.br) e grava em espelho/ultimo_resultado.json o que tiver o número mais
alto — evita ficar preso numa fonte que demorou mais pra "virar a chave" pro resultado novo.

Rodado pelo workflow .github/workflows/atualizar-resultado.yml a cada ~20 minutos.
"""
import json
import urllib.request

FONTES = {
    "oficial": "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil",
    "guidi": "https://api.guidi.dev.br/loteria/lotofacil/ultimo",
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


def main() -> None:
    candidatos = [buscar(url) for url in FONTES.values()]
    candidatos = [dados for dados in candidatos if dados.get("numero")]
    if not candidatos:
        raise SystemExit("Nenhuma das fontes respondeu com um concurso válido.")

    mais_novo = max(candidatos, key=lambda dados: dados["numero"])
    with open("espelho/ultimo_resultado.json", "w", encoding="utf-8") as arquivo:
        json.dump(mais_novo, arquivo, ensure_ascii=False)
    print(f"Usando concurso {mais_novo['numero']} (data {mais_novo.get('dataApuracao')}).")


if __name__ == "__main__":
    main()
