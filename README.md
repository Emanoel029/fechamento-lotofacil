# LotoFácil — Fechamento Intermediário (24 apostas)

**Publicado em:** https://emanoel029.github.io/fechamento-lotofacil/

Aplicativo web que implementa a lógica do esboço: o usuário escolhe **7 dezenas que devem ficar
de fora** e o sistema gera **24 apostas de 15 dezenas** usando apenas as 18 restantes. Sem
dependências, sem servidor, sem build — e com o **histórico real** dos concursos embutido.

![Apostas geradas](docs/screenshots/resultados.png)

## Novidades desta versão

- **Simulação em tempo real**: a cada dezena marcada (ao completar 7), a tabela “Se você tivesse
  jogado” é recalculada contra um concurso real escolhido no seletor — mostra quantidade por
  faixa, prêmio oficial do concurso, custo e **saldo (lucro/prejuízo)**.
- **Histórico real da Caixa**: 3.815 concursos (29/09/2003 a 27/10/2026), com as 15 dezenas e os
  valores de premiação de cada faixa.
- **Busca por concurso**: digite qualquer número (1 a 3.816) no campo e clique em Buscar; o app carrega aquele resultado.
- **Pares/ímpares por aposta**: cada cartão mostra `Aposta 6 (4p 11i)`.
- **Conferência por aposta**: selo com os pontos feitos no concurso escolhido.
- **Exportação** com pares, ímpares, acertos, custo e saldo.

## Como abrir

```bash
xdg-open index.html          # local
# ou
npm start                    # http://localhost:8080
```

O estado (seleção, concurso escolhido, preço da aposta e jogos salvos) fica no `localStorage`.

## A regra do jogo

- Universo: 25 dezenas (1–25).
- O usuário exclui 7 → sobram 18 no **pool**.
- Cada aposta tem 15 dezenas do pool → cada aposta **omite exatamente 3** dezenas do pool.
- 24 apostas distintas, todas de 15 dezenas.

Dualidade que sustenta o sistema:

```
aposta (15 dezenas)  ↔  trio omitido (3 dezenas)     15 + 3 = 18
escolher 24 apostas  ↔  escolher 24 trios distintos de C(18,3) = 816
```

## O que o sistema garante

Se as **7 exclusões estiverem corretas** (nenhuma delas sorteada):

| Garantia | Valor |
|---|---|
| Pior aposta | 12 pontos |
| Melhor aposta (pior caso) | **14 pontos ou mais, sempre** |
| Participação de cada dezena | 20 das 24 apostas |
| Apostas repetidas | nenhuma |

Se alguma exclusão errar, o pior caso do **melhor** resultado cai:

| Excluídas que saíram | Pior melhor acerto |
|---|---|
| 0 | 14 pontos |
| 1 | 13 pontos |
| 2 | 12 pontos |
| 3 | 11 pontos |
| 4 | 10 pontos (sem prêmio) |

Calculado exaustivamente sobre **todas** as combinações possíveis de dezenas não sorteadas
dentro do pool — não é estimativa. Reproduza com `npm run verify`.

Distribuição média com as 7 exclusões corretas (24 apostas):

| 15 pts | 14 pts | 13 pts | 12 pts |
|---|---|---|---|
| 0,03 | 1,32 | 9,26 | 13,38 |

Chance de 15 pontos, dado que as 7 exclusões estão certas: **24/816 ≈ 2,94%** (existe exatamente
1 trio perfeito entre os 816 possíveis; o sistema cobre 24).

## Como as 24 apostas são escolhidas

Não é sorteio nem heurística: é um desenho combinatório verificável.

1. O pool de 18 é dividido em dois grupos de 9.
2. Em cada grupo aplica-se o plano afim **AG(2,3)**: as 12 retas de 3 pontos formam um
   **sistema de triplas de Steiner STS(9)** — cada par de dezenas aparece em exatamente 1 reta e
   cada dezena em exatamente 4 retas.
3. 2 grupos × 12 retas = **24 trios omitidos**, que viram as 24 apostas.

Consequências: cada dezena é omitida 4 vezes (aparece em 20 apostas); os 72 pares internos são
cobertos uma única vez; todo conjunto de 3 dezenas não sorteadas contém um par interno (pombos nos
dois grupos) → alguma aposta omite só dezenas não sorteadas → **14 ou 15 pontos**.

## Simulação retroativa (a tabela do esboço)

No campo **Concurso** da tela **Criar jogo** você digita qualquer número (1 a 3.816) e clica em
Buscar — ou usa as sugestões do histórico. Para o concurso escolhido, o app usa as dezenas
sorteadas e os **valores oficiais de premiação** daquele concurso. Exemplo real
(concurso 3815, excluídas `01 02 07 08 18 20 24`):

| Faixa | Quantidade | Prêmio |
|---|---|---|
| 14 pontos | 1 | R$ 1.943,41 |
| 13 pontos | 10 | R$ 350,00 |
| 12 pontos | 13 | R$ 182,00 |
| **Total** | **24** | **R$ 2.475,41** |
| Custo (24 × R$ 3,50) | | R$ 84,00 |
| **Saldo** | | **+R$ 2.391,41** |

As quantidades (13×12, 10×13, 1×14) são idênticas às do esboço; a diferença é que agora os
prêmios são os reais do concurso, não valores fictícios.

O **preço por aposta** é editável (padrão R$ 3,50) e entra no cálculo de custo/saldo.

## Tendências com histórico real

Base embutida: **3.816 concursos** (concurso 1, de 29/09/2003, até o 3816, de 28/10/2026), com
fonte `loteriascaixa-api` (espelho dos dados da Caixa). A tela mostra frequência por dezena em
janelas de 10 a 100 concursos, marcação quente/frio e sugere as 7 menos frequentes.

A sugestão é **heurística**, não previsão: sorteios independentes não têm memória.

### Atualizar o histórico

```bash
python3 tools/build_history.py     # baixa da API e regenera data/historico.js
```

O arquivo tem ~350 KB e formato `[concurso, data, dezenas, prêmios]` ordenado do mais antigo ao
mais novo.

## Atualização automática (novos concursos)

O app se atualiza sozinho, em três camadas:

1. **A cada visita** ele consulta a API da Caixa (2,7 KB). Se houver concurso mais novo que a
   base embutida, ele é incluído na hora, com as dezenas e os prêmios oficiais; o seletor passa a
   apontar para ele e os resultados novos ficam guardados no `localStorage`.
2. **Se a Caixa falhar**, usa o espelho `espelho/ultimo_resultado.json` do repositório (atualizado
   por um workflow a cada 20 minutos).
3. **Com a página aberta**, nova consulta a cada 10 minutos e ao voltar para a aba — e há o botão
   **Atualizar** ao lado do seletor.

Além disso, o workflow `.github/workflows/atualizar-historico.yml` (na branch `main`) regenera
`data/historico.js` **a cada 6 horas**, para que até as janelas longas de tendências (50/100
concursos) fiquem completas mesmo para quem visita raramente. Se você digitar um concurso que
ainda não saiu, o app avisa e consulta a Caixa na hora.

Limites: depende da API da Caixa estar no ar (o fallback pode atrasar até ~20 min) e resultados
muito antigos que não passaram pelo app só entram na base pelo workflow de 6 horas.

## Exportação

“Exportar jogo para Excel” gera **CSV com BOM e separador `;`** (abre direto no Excel pt-BR):
excluídas, concurso, as 24 linhas com dezenas + **Pares/Ímpares** + acertos, resumo por faixa,
total, custo e saldo.

## Estrutura

```
index.html               interface (Início, Criar, Resultados, Salvos, Tendências)
styles.css               estilos
engine.js                núcleo puro: desenho, geração, pontuação, paridade, saldo, CSV
app.js                   estado, navegação, simulação em tempo real, localStorage
data/historico.js        histórico real (3.815 concursos + prêmios)
tests/engine.test.mjs    11 testes (estrutura, garantia exaustiva, paridade, saldo, CSV)
tools/build_history.py   gera data/historico.js a partir da API
tools/verify_design.py   verificação matemática independente (Python)
tools/ui-smoke.mjs       smoke test de UI via Chrome headless + CDP
docs/screenshots/        capturas das telas
```

## Testes

```bash
npm test          # 11 testes do núcleo (node:test)
npm run verify    # confere o desenho e as garantias em Python
npm run smoke     # dirige a interface no Chrome headless (local ou LF_URL=...)
```

O smoke test valida: seleção de 7 → simulação ao vivo; 24 cartões com paridade; conferência do
concurso 3815; jogo salvo; troca de concurso; tendências com a base real; CSV com custo/saldo.

## Publicação

O site é estático e está publicado no **GitHub Pages** a partir da branch `gh-pages` do
repositório `Emanoel029/fechamento-lotofacil` (a branch `main` preserva o app Flask original).

Para republicar:

```bash
git checkout gh-pages            # no clone do repositório
# copie index.html, styles.css, engine.js, app.js, data/, docs/screenshots/ e README.md
git add -A && git commit -m "Atualiza o app" && git push
```

Alternativas gratuitas: arrastar a pasta em https://app.netlify.com/drop ou publicar em
Cloudflare Pages/Vercel (todas servem arquivos estáticos sem backend).

## Limites (honestos)

- **Não prevê sorteio** e não aumenta o valor esperado; organiza cobertura.
- As quantidades por faixa variam conforme o concurso e as exclusões escolhidas.
- “Sugestão” de tendências é heurística, não modelo preditivo.
- Dados ficam no navegador (localStorage); “Jogos salvos” não sincroniza entre dispositivos.
- O histórico é um retrato de 28/10/2026; rode `tools/build_history.py` para atualizar.

Jogue com responsabilidade.
