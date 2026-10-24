const TODOS_OS_NUMEROS = Array.from({ length: 25 }, (_, i) => i + 1);

const estado = {
  modo: "realizado", // "realizado" ou "proximo"
  concursoDados: null, // objeto completo vindo de /api/concurso (modo "realizado")
  proximoConcursoDados: null, // { concurso, data, valorEstimado } (modo "proximo")
  sorteados: new Set(),
  ausentes: new Set(),
  excluidos: new Set(),
  ultimoResultado: null, // { concurso, excluidos, jogos, comparacao } do último "Gerar jogos"
  historico: { quantidade: 10, visao: "sorteados", dados: null },
};

const QUANTIDADES_HISTORICO = [10, 20, 30, 40, 50, 100];

const el = {
  abaCriar: document.getElementById("aba-criar"),
  abaSalvos: document.getElementById("aba-salvos"),
  abaHistorico: document.getElementById("aba-historico"),
  vistaCriar: document.getElementById("vista-criar"),
  vistaSalvos: document.getElementById("vista-salvos"),
  vistaHistorico: document.getElementById("vista-historico"),

  linhaQuantidade: document.getElementById("linha-quantidade"),
  statusHistorico: document.getElementById("status-historico"),
  blocoHistorico: document.getElementById("bloco-historico"),
  visaoSorteados: document.getElementById("visao-sorteados"),
  visaoAusentes: document.getElementById("visao-ausentes"),
  legendaFrequencia: document.getElementById("legenda-frequencia"),
  fileiraFrequencia: document.getElementById("fileira-frequencia"),
  cabecalhoHistorico: document.getElementById("cabecalho-historico"),
  corpoHistorico: document.getElementById("corpo-historico"),
  rodapeHistorico: document.getElementById("rodape-historico"),

  modoRealizado: document.getElementById("modo-realizado"),
  modoProximo: document.getElementById("modo-proximo"),
  blocoRealizado: document.getElementById("bloco-realizado"),
  blocoProximo: document.getElementById("bloco-proximo"),
  legendaSelecao: document.getElementById("legenda-selecao"),

  inputConcurso: document.getElementById("input-concurso"),
  botaoBuscar: document.getElementById("botao-buscar"),
  botaoMaisRecente: document.getElementById("botao-mais-recente"),
  statusConcurso: document.getElementById("status-concurso"),
  resultadoConcurso: document.getElementById("resultado-concurso"),
  numeroConcurso: document.getElementById("numero-concurso"),
  dataConcurso: document.getElementById("data-concurso"),
  gradeResultado: document.getElementById("grade-resultado"),

  statusProximo: document.getElementById("status-proximo"),
  resultadoProximo: document.getElementById("resultado-proximo"),
  numeroProximo: document.getElementById("numero-proximo"),
  dataProximo: document.getElementById("data-proximo"),
  numeroUltimoProximo: document.getElementById("numero-ultimo-proximo"),
  gradeUltimoProximo: document.getElementById("grade-ultimo-proximo"),

  gradeSelecao: document.getElementById("grade-selecao"),
  contadorSelecionados: document.getElementById("contador-selecionados"),
  contadorDetalhe: document.getElementById("contador-detalhe"),
  botaoGerar: document.getElementById("botao-gerar"),
  statusGerar: document.getElementById("status-gerar"),
  secaoJogos: document.getElementById("secao-jogos"),
  gradeJogos: document.getElementById("grade-jogos"),
  secaoComparacao: document.getElementById("secao-comparacao"),
  corpoTabelaComparacao: document.getElementById("corpo-tabela-comparacao"),
  totalJogosPremiados: document.getElementById("total-jogos-premiados"),
  totalValor: document.getElementById("total-valor"),
  botaoSalvar: document.getElementById("botao-salvar"),
  botaoExportar: document.getElementById("botao-exportar"),
  statusAcoes: document.getElementById("status-acoes"),

  textoSemSalvos: document.getElementById("texto-sem-salvos"),
  listaSalvos: document.getElementById("lista-salvos"),
  secaoDetalheSalvo: document.getElementById("secao-detalhe-salvo"),
  tituloDetalheSalvo: document.getElementById("titulo-detalhe-salvo"),
  mensagemAguardandoSalvo: document.getElementById("mensagem-aguardando-salvo"),
  gradeJogosSalvo: document.getElementById("grade-jogos-salvo"),
  tabelaComparacaoSalvo: document.getElementById("tabela-comparacao-salvo"),
  corpoTabelaSalvo: document.getElementById("corpo-tabela-salvo"),
  totalJogosPremiadosSalvo: document.getElementById("total-jogos-premiados-salvo"),
  totalValorSalvo: document.getElementById("total-valor-salvo"),
};

function formatarMoeda(valor) {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarData(isoString) {
  try {
    return new Date(isoString).toLocaleString("pt-BR");
  } catch {
    return isoString;
  }
}

// ---------- Abas ----------

function mostrarAba(aba) {
  el.vistaCriar.classList.toggle("oculto", aba !== "criar");
  el.vistaSalvos.classList.toggle("oculto", aba !== "salvos");
  el.vistaHistorico.classList.toggle("oculto", aba !== "historico");
  el.abaCriar.classList.toggle("ativa", aba === "criar");
  el.abaSalvos.classList.toggle("ativa", aba === "salvos");
  el.abaHistorico.classList.toggle("ativa", aba === "historico");

  if (aba === "salvos") {
    carregarListaDeSalvos();
  } else if (aba === "historico") {
    carregarHistorico(estado.historico.quantidade);
  }
}

el.abaCriar.addEventListener("click", () => mostrarAba("criar"));
el.abaSalvos.addEventListener("click", () => mostrarAba("salvos"));
el.abaHistorico.addEventListener("click", () => mostrarAba("historico"));

// ---------- Modo: sorteio já realizado x próximo sorteio ----------

function mudarModo(modo) {
  estado.modo = modo;
  const ehRealizado = modo === "realizado";

  el.modoRealizado.classList.toggle("ativo", ehRealizado);
  el.modoProximo.classList.toggle("ativo", !ehRealizado);
  el.blocoRealizado.classList.toggle("oculto", !ehRealizado);
  el.blocoProximo.classList.toggle("oculto", ehRealizado);

  el.legendaSelecao.textContent = ehRealizado
    ? "Clique em 7 números para excluir dos jogos. Os números com borda laranja são os que não saíram no sorteio escolhido — a estratégia sugere escolher entre eles."
    : "Clique em 7 números para excluir dos jogos. Os números com borda laranja são os que não saíram no último concurso — a estratégia sugere escolher entre eles, mas você pode marcar qualquer um dos 25.";

  estado.excluidos = new Set();
  esconderResultadosGerados();

  if (ehRealizado) {
    estado.ausentes = new Set();
    if (estado.concursoDados) {
      aplicarConcurso(estado.concursoDados);
    } else {
      buscarConcurso(null);
    }
  } else {
    estado.ausentes = new Set();
    renderGradeSelecao();
    if (estado.proximoConcursoDados) {
      aplicarProximoConcurso(estado.proximoConcursoDados);
    } else {
      buscarProximoConcurso();
    }
  }
}

el.modoRealizado.addEventListener("click", () => mudarModo("realizado"));
el.modoProximo.addEventListener("click", () => mudarModo("proximo"));

async function buscarProximoConcurso() {
  el.statusProximo.textContent = "Buscando...";
  el.statusProximo.className = "status";
  el.resultadoProximo.classList.add("oculto");
  atualizarContador();

  try {
    const resposta = await fetch("/api/proximo-concurso");
    const dados = await resposta.json();
    if (!resposta.ok) {
      throw new Error(dados.erro || "Não consegui buscar o próximo concurso.");
    }
    aplicarProximoConcurso(dados);
    el.statusProximo.textContent = "";
  } catch (erro) {
    el.statusProximo.textContent = erro.message;
    el.statusProximo.className = "status erro";
  }
}

function aplicarProximoConcurso(dados) {
  estado.proximoConcursoDados = dados;
  estado.ausentes = new Set(dados.ausentesUltimoConcurso || []);
  el.numeroProximo.textContent = dados.concurso;
  el.dataProximo.textContent = dados.data || "—";
  el.numeroUltimoProximo.textContent = dados.numeroUltimoConcurso ?? "—";
  el.resultadoProximo.classList.remove("oculto");
  renderGradeUltimoProximo();
  renderGradeSelecao();
  atualizarContador();
}

function renderGradeUltimoProximo() {
  el.gradeUltimoProximo.innerHTML = "";
  TODOS_OS_NUMEROS.forEach((numero) => {
    const bola = document.createElement("div");
    bola.className = "numero";
    if (estado.ausentes.has(numero)) {
      bola.classList.add("ausente");
    }
    bola.textContent = String(numero).padStart(2, "0");
    el.gradeUltimoProximo.appendChild(bola);
  });
}

// ---------- Buscar concurso ----------

async function buscarConcurso(numero) {
  el.statusConcurso.textContent = "Buscando...";
  el.statusConcurso.className = "status";
  el.botaoGerar.disabled = true;
  esconderResultadosGerados();

  const url = numero ? `/api/concurso?numero=${numero}` : "/api/concurso";
  try {
    const resposta = await fetch(url);
    const dados = await resposta.json();
    if (!resposta.ok) {
      throw new Error(dados.erro || "Não consegui buscar o concurso.");
    }
    aplicarConcurso(dados);
    el.statusConcurso.textContent = "";
  } catch (erro) {
    el.statusConcurso.textContent = erro.message;
    el.statusConcurso.className = "status erro";
    el.resultadoConcurso.classList.add("oculto");
  }
}

function aplicarConcurso(dados) {
  estado.concursoDados = dados;
  estado.sorteados = new Set(dados.sorteados);
  estado.ausentes = new Set(dados.ausentes);
  estado.excluidos = new Set();

  el.inputConcurso.value = dados.concurso;
  el.numeroConcurso.textContent = dados.concurso;
  el.dataConcurso.textContent = dados.data || "—";
  el.resultadoConcurso.classList.remove("oculto");

  renderGradeResultado();
  renderGradeSelecao();
  atualizarContador();
}

function renderGradeResultado() {
  el.gradeResultado.innerHTML = "";
  TODOS_OS_NUMEROS.forEach((numero) => {
    const bola = document.createElement("div");
    bola.className = "numero";
    if (estado.sorteados.has(numero)) {
      bola.classList.add("sorteado");
    } else if (estado.ausentes.has(numero)) {
      bola.classList.add("ausente");
    }
    bola.textContent = String(numero).padStart(2, "0");
    el.gradeResultado.appendChild(bola);
  });
}

function renderGradeSelecao() {
  el.gradeSelecao.innerHTML = "";
  TODOS_OS_NUMEROS.forEach((numero) => {
    const bola = document.createElement("div");
    bola.className = "numero clicavel";
    if (estado.ausentes.has(numero)) {
      bola.classList.add("ausente");
    }
    if (estado.excluidos.has(numero)) {
      bola.classList.add("excluido");
    }
    bola.textContent = String(numero).padStart(2, "0");
    bola.addEventListener("click", () => alternarExclusao(numero, bola));
    el.gradeSelecao.appendChild(bola);
  });
}

function alternarExclusao(numero, bola) {
  if (estado.excluidos.has(numero)) {
    estado.excluidos.delete(numero);
    bola.classList.remove("excluido");
  } else {
    if (estado.excluidos.size >= 7) {
      return;
    }
    estado.excluidos.add(numero);
    bola.classList.add("excluido");
  }
  atualizarContador();
}

function atualizarContador() {
  el.contadorSelecionados.textContent = estado.excluidos.size;
  const temConcursoDeReferencia =
    estado.modo === "realizado" ? estado.concursoDados !== null : estado.proximoConcursoDados !== null;
  el.botaoGerar.disabled = estado.excluidos.size !== 7 || !temConcursoDeReferencia;

  if (estado.excluidos.size > 0) {
    const palpites = Array.from(estado.excluidos).filter((n) => estado.ausentes.has(n)).length;
    const curingas = estado.excluidos.size - palpites;
    const palpitesTexto = `${palpites} que não ${palpites === 1 ? "saiu" : "saíram"}`;
    const curingasTexto = `${curingas} que ${curingas === 1 ? "saiu" : "saíram"}`;
    el.contadorDetalhe.textContent = curingas > 0 ? `(${palpitesTexto} + ${curingasTexto})` : `(${palpitesTexto})`;
  } else {
    el.contadorDetalhe.textContent = "";
  }
}

function esconderResultadosGerados() {
  el.secaoJogos.classList.add("oculto");
  el.secaoComparacao.classList.add("oculto");
  el.statusAcoes.textContent = "";
  estado.ultimoResultado = null;
}

// ---------- Gerar jogos ----------

async function gerarJogos() {
  el.statusGerar.textContent = "Gerando...";
  el.statusGerar.className = "status";
  el.botaoGerar.disabled = true;

  const excluidos = Array.from(estado.excluidos);
  const corpoRequisicao =
    estado.modo === "realizado"
      ? { concurso: estado.concursoDados.concurso, excluidos }
      : { modoProximo: true, excluidos };

  try {
    const resposta = await fetch("/api/gerar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpoRequisicao),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      throw new Error(dados.erro || "Não consegui gerar os jogos.");
    }
    const sorteados = dados.concurso.sorteados ? new Set(dados.concurso.sorteados) : null;
    renderJogos(el.gradeJogos, dados.jogos, sorteados);
    if (dados.comparacao) {
      renderComparacao(el.corpoTabelaComparacao, el.totalJogosPremiados, el.totalValor, dados.comparacao);
      el.secaoComparacao.classList.remove("oculto");
    } else {
      el.secaoComparacao.classList.add("oculto");
    }
    el.secaoJogos.classList.remove("oculto");
    el.statusGerar.textContent = "";
    el.statusAcoes.textContent = "";

    estado.ultimoResultado = {
      concurso: dados.concurso,
      excluidos,
      jogos: dados.jogos,
      comparacao: dados.comparacao,
    };
  } catch (erro) {
    el.statusGerar.textContent = erro.message;
    el.statusGerar.className = "status erro";
  } finally {
    el.botaoGerar.disabled = estado.excluidos.size !== 7;
  }
}

function renderJogos(destino, jogos, sorteados) {
  destino.innerHTML = "";
  jogos.forEach((jogo, indice) => {
    const jogoSet = new Set(jogo);
    const cartao = document.createElement("div");
    cartao.className = "cartao-jogo";

    const pontos = sorteados ? jogo.filter((n) => sorteados.has(n)).length : null;
    if (pontos !== null && pontos >= 14) {
      cartao.classList.add(pontos === 15 ? "destaque-15" : "destaque-14");
    }

    const pares = jogo.filter((n) => n % 2 === 0).length;
    const impares = jogo.length - pares;

    const titulo = document.createElement("h3");

    const nomeAposta = document.createElement("span");
    nomeAposta.className = "titulo-aposta";
    nomeAposta.textContent = `Aposta ${indice + 1}`;
    titulo.appendChild(nomeAposta);

    const contagem = document.createElement("span");
    contagem.className = "contagem-par-impar";
    contagem.textContent = `(${pares}p ${impares}i)`;
    titulo.appendChild(contagem);

    if (pontos !== null && pontos >= 14) {
      const selo = document.createElement("span");
      selo.className = "selo-pontos";
      selo.textContent = pontos === 15 ? "🏆 15 pontos" : "⭐ 14 pontos";
      titulo.appendChild(selo);
    }
    cartao.appendChild(titulo);

    const miniGrade = document.createElement("div");
    miniGrade.className = "mini-grade";
    TODOS_OS_NUMEROS.forEach((numero) => {
      const mini = document.createElement("div");
      mini.className = "mini-numero";
      if (jogoSet.has(numero)) {
        mini.classList.add("presente");
      }
      mini.textContent = String(numero).padStart(2, "0");
      miniGrade.appendChild(mini);
    });
    cartao.appendChild(miniGrade);

    destino.appendChild(cartao);
  });
}

function renderComparacao(corpoTabela, totalJogosEl, totalValorEl, comparacao) {
  corpoTabela.innerHTML = "";
  comparacao.linhas.forEach((linha) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${linha.pontos} pontos</td>
      <td>${linha.quantidade}</td>
      <td>${formatarMoeda(linha.valorUnitario)}</td>
      <td>${formatarMoeda(linha.valorFaixa)}</td>
    `;
    corpoTabela.appendChild(tr);
  });
  totalJogosEl.innerHTML = `<strong>${comparacao.totalJogosPremiados}</strong>`;
  totalValorEl.innerHTML = `<strong>${formatarMoeda(comparacao.valorTotal)}</strong>`;
}

// ---------- Salvar / exportar o jogo recém-gerado ----------

function baixarArquivo(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function salvarJogoAtual() {
  if (!estado.ultimoResultado) return;
  el.statusAcoes.textContent = "Salvando...";
  el.statusAcoes.className = "status";
  try {
    const resposta = await fetch("/api/salvar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estado.ultimoResultado),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      throw new Error(dados.erro || "Não consegui salvar.");
    }
    el.statusAcoes.textContent = "Jogo salvo! Veja na aba \"Jogos salvos\".";
    el.statusAcoes.className = "status ok";
  } catch (erro) {
    el.statusAcoes.textContent = erro.message;
    el.statusAcoes.className = "status erro";
  }
}

async function exportarJogoAtual() {
  if (!estado.ultimoResultado) return;
  el.statusAcoes.textContent = "Gerando planilha...";
  el.statusAcoes.className = "status";
  try {
    const resposta = await fetch("/api/exportar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(estado.ultimoResultado),
    });
    if (!resposta.ok) {
      const dados = await resposta.json();
      throw new Error(dados.erro || "Não consegui exportar.");
    }
    const blob = await resposta.blob();
    baixarArquivo(blob, `lotofacil-concurso-${estado.ultimoResultado.concurso.concurso}.csv`);
    el.statusAcoes.textContent = "Planilha baixada!";
    el.statusAcoes.className = "status ok";
  } catch (erro) {
    el.statusAcoes.textContent = erro.message;
    el.statusAcoes.className = "status erro";
  }
}

// ---------- Jogos salvos ----------

async function atualizarListaDeSalvos() {
  el.listaSalvos.innerHTML = "";
  try {
    const resposta = await fetch("/api/salvos");
    const dados = await resposta.json();
    const salvos = dados.salvos || [];
    el.textoSemSalvos.classList.toggle("oculto", salvos.length > 0);
    salvos.forEach((item) => el.listaSalvos.appendChild(criarLinhaSalvo(item)));
  } catch (erro) {
    el.textoSemSalvos.textContent = "Não consegui carregar os jogos salvos.";
    el.textoSemSalvos.classList.remove("oculto");
  }
}

async function carregarListaDeSalvos() {
  el.secaoDetalheSalvo.classList.add("oculto");
  await atualizarListaDeSalvos();
}

function criarLinhaSalvo(item) {
  const linha = document.createElement("div");
  linha.className = "item-salvo";

  const excluidosTexto = item.excluidos.map((n) => String(n).padStart(2, "0")).join(", ");
  const linhaResultado = item.aindaNaoSorteado
    ? `Aguardando o sorteio de ${item.data || "—"}`
    : `${item.totalJogosPremiados} apostas premiadas — R$ ${formatarMoeda(item.valorTotal)}`;
  const info = document.createElement("div");
  info.className = "info-salvo";
  info.innerHTML = `
    <strong>Concurso ${item.concurso}</strong> — salvo em ${formatarData(item.criadoEm)}<br>
    Excluídos: ${excluidosTexto}<br>
    ${linhaResultado}
  `;

  const acoes = document.createElement("div");
  acoes.className = "acoes-salvo";

  const botaoVer = document.createElement("button");
  botaoVer.textContent = "Ver";
  botaoVer.addEventListener("click", () => verDetalheSalvo(item.id));

  const botaoExportar = document.createElement("button");
  botaoExportar.textContent = "Exportar";
  botaoExportar.className = "botao-secundario";
  botaoExportar.addEventListener("click", () => exportarSalvo(item.id));

  const botaoExcluir = document.createElement("button");
  botaoExcluir.textContent = "Excluir";
  botaoExcluir.className = "botao-perigo";
  botaoExcluir.addEventListener("click", () => excluirSalvo(item.id));

  acoes.append(botaoVer, botaoExportar, botaoExcluir);
  linha.append(info, acoes);
  return linha;
}

async function verDetalheSalvo(id) {
  el.tituloDetalheSalvo.textContent = "Carregando...";
  el.secaoDetalheSalvo.classList.remove("oculto");
  el.secaoDetalheSalvo.scrollIntoView({ behavior: "smooth" });

  const resposta = await fetch(`/api/salvos/${id}`);
  const registro = await resposta.json();
  if (!resposta.ok) {
    alert(registro.erro || "Não consegui abrir esse jogo salvo.");
    el.secaoDetalheSalvo.classList.add("oculto");
    return;
  }

  el.tituloDetalheSalvo.textContent = `Concurso ${registro.concurso.concurso} — salvo em ${formatarData(registro.criadoEm)}`;

  if (registro.comparacao) {
    el.mensagemAguardandoSalvo.classList.add("oculto");
    el.tabelaComparacaoSalvo.classList.remove("oculto");
    const sorteados = new Set(registro.concurso.sorteados);
    renderJogos(el.gradeJogosSalvo, registro.jogos, sorteados);
    renderComparacao(el.corpoTabelaSalvo, el.totalJogosPremiadosSalvo, el.totalValorSalvo, registro.comparacao);
  } else {
    el.tabelaComparacaoSalvo.classList.add("oculto");
    el.mensagemAguardandoSalvo.textContent = `Esse sorteio ainda não aconteceu. Volte aqui depois do dia ${registro.concurso.data || "—"} pra ver quantos pontos cada aposta fez.`;
    el.mensagemAguardandoSalvo.classList.remove("oculto");
    renderJogos(el.gradeJogosSalvo, registro.jogos, null);
  }

  // o servidor pode ter atualizado a comparação agora mesmo (sorteio saiu) —
  // atualiza a listinha de cima também, pra refletir isso sem precisar recarregar.
  atualizarListaDeSalvos();
}

function exportarSalvo(id) {
  window.location.href = `/api/salvos/${id}/exportar`;
}

async function excluirSalvo(id) {
  if (!confirm("Excluir este jogo salvo? Não dá pra desfazer.")) return;
  const resposta = await fetch(`/api/salvos/${id}`, { method: "DELETE" });
  if (!resposta.ok) {
    const dados = await resposta.json();
    alert(dados.erro || "Não consegui excluir.");
    return;
  }
  carregarListaDeSalvos();
}

// ---------- Histórico ----------

function montarBotoesDeQuantidade() {
  el.linhaQuantidade.innerHTML = "";
  QUANTIDADES_HISTORICO.forEach((quantidade) => {
    const botao = document.createElement("button");
    botao.textContent = String(quantidade);
    botao.className = quantidade === estado.historico.quantidade ? "ativo" : "";
    botao.addEventListener("click", () => {
      estado.historico.quantidade = quantidade;
      montarBotoesDeQuantidade();
      carregarHistorico(quantidade);
    });
    el.linhaQuantidade.appendChild(botao);
  });
}

async function carregarHistorico(quantidade) {
  el.statusHistorico.textContent = "Buscando os últimos concursos...";
  el.statusHistorico.className = "status";
  el.blocoHistorico.classList.add("oculto");

  try {
    const resposta = await fetch(`/api/historico?quantidade=${quantidade}`);
    const dados = await resposta.json();
    if (!resposta.ok) {
      throw new Error(dados.erro || "Não consegui buscar o histórico.");
    }
    estado.historico.dados = dados;
    renderHistoricoCompleto();
    el.statusHistorico.textContent = "";
    el.blocoHistorico.classList.remove("oculto");
  } catch (erro) {
    el.statusHistorico.textContent = erro.message;
    el.statusHistorico.className = "status erro";
  }
}

function mudarVisaoHistorico(visao) {
  estado.historico.visao = visao;
  el.visaoSorteados.classList.toggle("ativo", visao === "sorteados");
  el.visaoAusentes.classList.toggle("ativo", visao === "ausentes");
  el.blocoHistorico.classList.toggle("visao-ausentes", visao === "ausentes");
  if (estado.historico.dados) {
    renderHistoricoCompleto();
  }
}

el.visaoSorteados.addEventListener("click", () => mudarVisaoHistorico("sorteados"));
el.visaoAusentes.addEventListener("click", () => mudarVisaoHistorico("ausentes"));

function renderHistoricoCompleto() {
  const dados = estado.historico.dados;
  const ehAusentes = estado.historico.visao === "ausentes";

  el.legendaFrequencia.textContent = ehAusentes
    ? "Frequência de cada dezena ficando de fora no período (da que mais ficou de fora pra que menos ficou):"
    : "Frequência de cada dezena no período (da que mais saiu pra que menos saiu):";

  renderFrequencia(ehAusentes ? dados.frequenciasAusentes : dados.frequencias);
  renderTabelaHistorico(dados, ehAusentes);
}

function renderFrequencia(frequencias) {
  el.fileiraFrequencia.innerHTML = "";
  const maxQuantidade = Math.max(...frequencias.map((f) => f.quantidade), 1);
  const minQuantidade = Math.min(...frequencias.map((f) => f.quantidade));
  const amplitude = Math.max(maxQuantidade - minQuantidade, 1);

  frequencias.forEach((item) => {
    const intensidade = (item.quantidade - minQuantidade) / amplitude;
    const bloco = document.createElement("div");
    bloco.className = "item-frequencia" + (intensidade < 0.45 ? " texto-escuro" : "");
    bloco.style.setProperty("--intensidade", intensidade);

    const numero = document.createElement("div");
    numero.className = "numero-frequencia";
    numero.textContent = String(item.numero).padStart(2, "0");

    const contagem = document.createElement("div");
    contagem.className = "contagem-frequencia";
    contagem.textContent = item.quantidade;

    bloco.append(numero, contagem);
    el.fileiraFrequencia.appendChild(bloco);
  });
}

function renderTabelaHistorico(dados, ehAusentes) {
  el.cabecalhoHistorico.innerHTML = `
    <th class="coluna-concurso">Concurso</th>
    ${TODOS_OS_NUMEROS.map((n) => `<th>${String(n).padStart(2, "0")}</th>`).join("")}
    <th>Repetentes</th>
    <th>Pares</th>
    <th>Ímpares</th>
  `;

  el.corpoHistorico.innerHTML = "";
  dados.linhas.forEach((linha) => {
    const destacados = new Set(ehAusentes ? linha.ausentes : linha.sorteados);
    const repetentes = ehAusentes ? linha.repetentesAusentes : linha.repetentes;
    const pares = ehAusentes ? linha.paresAusentes : linha.pares;
    const impares = ehAusentes ? linha.imparesAusentes : linha.impares;

    const tr = document.createElement("tr");

    const celulaConcurso = document.createElement("td");
    celulaConcurso.className = "coluna-concurso";
    celulaConcurso.textContent = linha.concurso;
    tr.appendChild(celulaConcurso);

    TODOS_OS_NUMEROS.forEach((numero) => {
      const td = document.createElement("td");
      if (destacados.has(numero)) {
        td.textContent = String(numero).padStart(2, "0");
        td.className = "numero-sorteado";
      }
      tr.appendChild(td);
    });

    const celulaRepetentes = document.createElement("td");
    if (repetentes === null) {
      celulaRepetentes.textContent = "–";
      celulaRepetentes.className = "sem-repetentes";
    } else {
      celulaRepetentes.textContent = repetentes;
    }
    tr.appendChild(celulaRepetentes);

    const celulaPares = document.createElement("td");
    celulaPares.textContent = pares;
    celulaPares.className = pares > impares ? "maior" : "";
    tr.appendChild(celulaPares);

    const celulaImpares = document.createElement("td");
    celulaImpares.textContent = impares;
    celulaImpares.className = impares > pares ? "maior" : "";
    tr.appendChild(celulaImpares);

    el.corpoHistorico.appendChild(tr);
  });

  const colspanVazio = TODOS_OS_NUMEROS.length;
  const mediaRepetentes = ehAusentes ? dados.mediaRepetentesAusentes : dados.mediaRepetentes;
  const mediaPares = ehAusentes ? dados.mediaParesAusentes : dados.mediaPares;
  const mediaImpares = ehAusentes ? dados.mediaImparesAusentes : dados.mediaImpares;
  const somaPares = ehAusentes ? dados.somaParesAusentes : dados.somaPares;
  const somaImpares = ehAusentes ? dados.somaImparesAusentes : dados.somaImpares;

  el.rodapeHistorico.innerHTML = `
    <tr>
      <td class="coluna-concurso">Média</td>
      <td colspan="${colspanVazio}"></td>
      <td>${mediaRepetentes ?? "–"}</td>
      <td>${mediaPares ?? "–"}</td>
      <td>${mediaImpares ?? "–"}</td>
    </tr>
    <tr>
      <td class="coluna-concurso">Total</td>
      <td colspan="${colspanVazio}"></td>
      <td>–</td>
      <td>${somaPares}</td>
      <td>${somaImpares}</td>
    </tr>
  `;
}

// ---------- Eventos ----------

el.botaoBuscar.addEventListener("click", () => {
  const numero = el.inputConcurso.value ? parseInt(el.inputConcurso.value, 10) : null;
  buscarConcurso(numero);
});

el.botaoMaisRecente.addEventListener("click", () => {
  el.inputConcurso.value = "";
  buscarConcurso(null);
});

el.botaoGerar.addEventListener("click", gerarJogos);
el.botaoSalvar.addEventListener("click", salvarJogoAtual);
el.botaoExportar.addEventListener("click", exportarJogoAtual);

montarBotoesDeQuantidade();
buscarConcurso(null);
