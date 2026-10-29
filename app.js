(function () {
  'use strict';

  var E = window.LotoEngine;
  var HISTORY = (window.LOTOFACIL_HISTORICO && window.LOTOFACIL_HISTORICO.concursos) || [];
  var HISTORY_META = window.LOTOFACIL_HISTORICO || {};
  var BY_CONCURSO = {};
  HISTORY.forEach(function (row) { BY_CONCURSO[row[0]] = row; });
  var LATEST = HISTORY.length ? HISTORY[HISTORY.length - 1][0] : null;
  var STATIC_LATEST = LATEST;
  var EXTRAS_KEY = 'lotofacil.extras.v1';
  var UPDATE_SOURCES = [
    'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil',
    'https://raw.githubusercontent.com/Emanoel029/fechamento-lotofacil/main/espelho/ultimo_resultado.json'
  ];

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var STORE = 'lotofacil.v2';
  var PRIZE_ORDER = [11, 12, 13, 14, 15];
  var WINDOWS = [10, 20, 30, 40, 50, 100];
  var VIEWS = ['inicio', 'criar', 'resultados', 'salvos', 'tendencias'];

  var state = {
    view: 'inicio',
    excluded: [],
    seed: 0,
    concurso: LATEST,
    price: 3.5,
    generation: null,
    saved: [],
    trends: { window: 20, suggestion: [] }
  };

  var toastTimer = null;

  /* ---------------- histórico ---------------- */
  function rowOf(concurso) {
    return BY_CONCURSO[concurso] || (HISTORY.length ? HISTORY[HISTORY.length - 1] : null);
  }
  function drawOf(row) { return row ? { concurso: row[0], data: row[1], dezenas: row[2] } : null; }
  function prizesOf(row) { return E.prizeMap(row ? row[3] : null); }
  function currentRow() { return rowOf(state.concurso); }

  function addRow(row) {
    if (!row || BY_CONCURSO[row[0]]) return false;
    BY_CONCURSO[row[0]] = row;
    HISTORY.push(row);
    HISTORY.sort(function (a, b) { return a[0] - b[0]; });
    LATEST = HISTORY[HISTORY.length - 1][0];
    return true;
  }

  function persistExtras() {
    try {
      var extras = HISTORY.filter(function (r) { return r[0] > STATIC_LATEST; });
      localStorage.setItem(EXTRAS_KEY, JSON.stringify(extras));
    } catch (err) {
      console.warn('Não foi possível guardar os resultados novos:', err);
    }
  }

  function loadExtras() {
    var raw;
    try { raw = localStorage.getItem(EXTRAS_KEY); } catch (err) { return; }
    if (!raw) return;
    try {
      JSON.parse(raw).forEach(function (row) {
        if (Array.isArray(row) && row.length === 4 && Array.isArray(row[2]) && row[2].length === E.GAME_SIZE) {
          addRow(row);
        }
      });
    } catch (err) { /* ignora extra inválido */ }
  }

  /* ---------------- persistência ---------------- */
  function saveState() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        excluded: state.excluded,
        seed: state.seed,
        concurso: state.concurso,
        price: state.price,
        saved: state.saved,
        trends: { window: state.trends.window }
      }));
    } catch (err) {
      console.warn('Não foi possível salvar o estado:', err);
    }
  }

  function loadState() {
    var raw;
    try { raw = localStorage.getItem(STORE); } catch (err) { return; }
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (Array.isArray(p.excluded)) {
        state.excluded = p.excluded.filter(function (n) {
          return Number.isInteger(n) && n >= 1 && n <= E.TOTAL;
        }).slice(0, E.EXCLUDED_COUNT);
      }
      if (Number.isInteger(p.seed)) state.seed = p.seed;
      if (p.concurso != null && BY_CONCURSO[p.concurso]) state.concurso = p.concurso;
      if (typeof p.price === 'number' && p.price >= 0) state.price = p.price;
      if (Array.isArray(p.saved)) {
        state.saved = p.saved.filter(function (g) { return g && Array.isArray(g.excluded); });
      }
      if (p.trends && WINDOWS.indexOf(p.trends.window) >= 0) state.trends.window = p.trends.window;
    } catch (err) {
      console.warn('Estado salvo inválido, ignorando:', err);
    }
  }

  /* ---------------- utilidades ---------------- */
  function toast(msg, ms) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2800);
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function stamp() {
    var d = new Date();
    return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function money(v) { return 'R$ ' + E.formatBRL(v); }
  function signedMoney(v) { return (v >= 0 ? '+' : '−') + money(Math.abs(v)); }

  /* ---------------- navegação ---------------- */
  function show(view) {
    if (VIEWS.indexOf(view) < 0) view = 'inicio';
    state.view = view;
    try { history.replaceState(null, '', '#' + view); } catch (err) { /* file:// */ }
    $$('.view').forEach(function (sec) { sec.hidden = sec.id !== 'view-' + view; });
    $$('#nav button').forEach(function (b) {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (view === 'criar') renderCriar();
    if (view === 'resultados') renderResultados();
    if (view === 'salvos') renderSaved();
    if (view === 'tendencias') renderTrends();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------------- volante ---------------- */
  function buildVolante() {
    var host = $('#volante');
    host.innerHTML = '';
    [[1, 9], [10, 18], [19, 25]].forEach(function (range) {
      var row = document.createElement('div');
      row.className = 'row';
      for (var n = range[0]; n <= range[1]; n++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = E.pad(n);
        b.dataset.n = String(n);
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-label', 'Dezena ' + E.pad(n));
        b.addEventListener('click', function () { toggleNumber(Number(this.dataset.n)); });
        row.appendChild(b);
      }
      host.appendChild(row);
    });
    paintVolante();
  }

  function paintVolante() {
    var sel = {};
    state.excluded.forEach(function (n) { sel[n] = true; });
    $$('#volante button').forEach(function (b) {
      var on = !!sel[Number(b.dataset.n)];
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function toggleNumber(n) {
    var i = state.excluded.indexOf(n);
    if (i >= 0) {
      state.excluded.splice(i, 1);
    } else if (state.excluded.length >= E.EXCLUDED_COUNT) {
      toast('Você já escolheu 7 dezenas. Remova uma para trocar.');
      return;
    } else {
      state.excluded.push(n);
      state.excluded.sort(function (a, b) { return a - b; });
    }
    state.generation = null;
    paintVolante();
    updatePickerStatus();
    updateSimulation();
    saveState();
  }

  function updatePickerStatus() {
    var hint = $('#picker-hint');
    var n = state.excluded.length;
    hint.textContent = n + ' de ' + E.EXCLUDED_COUNT + ' selecionadas' +
      (n === E.EXCLUDED_COUNT ? ' — simulação atualizada' : '');
    hint.classList.toggle('is-warn', n > 0 && n < E.EXCLUDED_COUNT);
    $('#btn-gerar').disabled = n !== E.EXCLUDED_COUNT;
  }

  /* ---------------- geração ---------------- */
  function ensureGeneration() {
    if (state.excluded.length !== E.EXCLUDED_COUNT) { state.generation = null; return null; }
    var key = state.excluded.join(',');
    if (state.generation && state.generation.seed === state.seed &&
        state.generation.excluded.join(',') === key) {
      return state.generation;
    }
    try {
      state.generation = E.buildGames(state.excluded, { seed: state.seed });
    } catch (err) {
      console.error(err);
      state.generation = null;
    }
    return state.generation;
  }

  /* ---------------- criar / simulação ---------------- */
  function buildConcursoList() {
    var list = $('#lista-concursos');
    list.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var i = HISTORY.length - 1; i >= 0; i--) {
      var opt = document.createElement('option');
      opt.value = String(HISTORY[i][0]);
      opt.label = HISTORY[i][1];
      frag.appendChild(opt);
    }
    list.appendChild(frag);
  }

  function setUpdateStatus(text) {
    var el = $('#update-status');
    if (el) el.textContent = text;
  }

  function rerender() {
    if (state.view === 'criar') renderCriar();
    else if (state.view === 'resultados') renderResultados();
    else if (state.view === 'tendencias') renderTrends();
  }

  var lastRefresh = 0;
  var pendingConcurso = null;

  function applyConcurso(value) {
    var n = parseInt(String(value || '').trim(), 10);
    if (!isFinite(n) || n < 1) {
      toast('Digite um número de concurso válido.');
      return;
    }
    if (BY_CONCURSO[n]) {
      pendingConcurso = null;
      state.concurso = n;
      saveState();
      renderBalls();
      updateSimulation();
      renderResultados();
      $('#inp-concurso').value = String(n);
      setUpdateStatus('Concurso ' + n + ' (' + BY_CONCURSO[n][1] + ') carregado.');
      return;
    }
    if (n > LATEST) {
      pendingConcurso = n;
      refreshLatest(false);
      setUpdateStatus('Concurso ' + n + ' ainda não está na base (último: ' + LATEST + '). Verificando…');
      return;
    }
    setUpdateStatus('Concurso ' + n + ' não encontrado na base.');
    toast('Concurso ' + n + ' não encontrado.');
  }

  function refreshLatest(manual) {
    lastRefresh = Date.now();
    var index = 0;
    setUpdateStatus('Verificando novos resultados…');

    function attempt() {
      if (index >= UPDATE_SOURCES.length) {
        setUpdateStatus('Sem conexão para atualizar agora · base local até o concurso ' + LATEST + '.');
        if (manual) toast('Não foi possível atualizar agora.');
        return;
      }
      var url = UPDATE_SOURCES[index++];
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 7000);

      fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) {
          clearTimeout(timer);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (json) {
          var row = E.parseCaixaResult(json);
          if (!row) throw new Error('resultado inválido');
          if (row[0] > LATEST) {
            var previous = LATEST;
            addRow(row);
            persistExtras();
            buildConcursoList();
            if (state.concurso === previous) state.concurso = row[0];
            if (pendingConcurso && BY_CONCURSO[pendingConcurso]) {
              state.concurso = pendingConcurso;
              pendingConcurso = null;
            }
            saveState();
            setUpdateStatus('Atualizado agora: concurso ' + row[0] + ' (' + row[1] + ').');
            rerender();
            if (manual) toast('Novo resultado incluído: concurso ' + row[0] + '.');
          } else if (pendingConcurso) {
            setUpdateStatus('O concurso ' + pendingConcurso + ' ainda não saiu. Último: ' + LATEST +
              ' (' + (rowOf(LATEST) ? rowOf(LATEST)[1] : '—') + ').');
            pendingConcurso = null;
          } else {
            setUpdateStatus('Base em dia: concurso ' + LATEST + ' (' + (rowOf(LATEST) ? rowOf(LATEST)[1] : '—') + ').');
            if (manual) toast('Já está atualizado com o último concurso.');
          }
        })
        .catch(function () { attempt(); });
    }

    attempt();
  }

  function renderCriar() {
    paintVolante();
    updatePickerStatus();
    if (!BY_CONCURSO[state.concurso]) state.concurso = LATEST;
    $('#inp-concurso').value = String(state.concurso);
    $('#concurso-hint').textContent = 'Último concurso: ' + LATEST + ' · digite qualquer número de 1 a ' + LATEST + '.';
    $('#inp-preco').value = String(state.price);
    renderBalls();
    updateSimulation();
  }

  function renderBalls() {
    var host = $('#draw-balls');
    var row = currentRow();
    if (!row) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = '';
    row[2].forEach(function (n) {
      var b = document.createElement('span');
      b.className = 'ball';
      b.textContent = E.pad(n);
      host.appendChild(b);
    });
  }

  function updateSimulation() {
    var tbody = $('#tbl-premios tbody');
    var table = $('#tbl-premios');
    var note = $('#prize-note');
    var summary = $('#sim-summary');
    var row = currentRow();
    var gen = ensureGeneration();

    tbody.innerHTML = '';
    var oldFoot = table.querySelector('tfoot');
    if (oldFoot) oldFoot.remove();

    if (!row) {
      note.textContent = 'Histórico indisponível.';
      summary.innerHTML = '';
      return;
    }

    if (!gen) {
      PRIZE_ORDER.slice().reverse().forEach(function (tier) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + tier + ' pontos</td><td class="num">—</td><td class="num">—</td>';
        tbody.appendChild(tr);
      });
      var missing = E.EXCLUDED_COUNT - state.excluded.length;
      note.textContent = 'Selecione as 7 dezenas excluídas para simular' +
        (missing > 0 ? ' (faltam ' + missing + ').' : '.');
      summary.innerHTML = '';
      return;
    }

    var score = E.scoreGames(gen.games, row[2], prizesOf(row));
    var bal = E.balance(score, state.price);

    PRIZE_ORDER.slice().reverse().forEach(function (tier) {
      var r = score.rows.find(function (x) { return x.tier === tier; });
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + tier + ' pontos</td>' +
        '<td class="num">' + (r ? r.count : 0) + '</td>' +
        '<td class="num">' + E.formatBRL(r ? r.subtotal : 0) + '</td>';
      tbody.appendChild(tr);
    });

    var foot = document.createElement('tfoot');
    var ftr = document.createElement('tr');
    ftr.innerHTML = '<td>Total</td><td class="num">' + score.totalGames + '</td>' +
      '<td class="num">' + E.formatBRL(score.totalPrize) + '</td>';
    foot.appendChild(ftr);
    table.appendChild(foot);

    note.textContent = 'Concurso ' + row[0] + ' (' + row[1] + ') · melhor aposta ' +
      score.best + ' pontos, pior ' + score.worst + '.';

    summary.innerHTML =
      '<div class="stat"><span>Custo</span><strong>' + money(bal.cost) + '</strong></div>' +
      '<div class="stat"><span>Prêmio</span><strong>' + money(bal.prize) + '</strong></div>' +
      '<div class="stat"><span>Saldo</span><strong class="' + (bal.profit >= 0 ? 'pos' : 'neg') + '">' +
        signedMoney(bal.profit) + '</strong></div>';
  }

  /* ---------------- resultados ---------------- */
  function renderGameCard(g, drawSet) {
    var card = document.createElement('article');
    card.className = 'game';
    var h = document.createElement('h3');
    var label = document.createElement('span');
    var p = E.parity(g.numbers);
    label.textContent = 'Aposta ' + g.index + ' (' + p.evens + 'p ' + p.odds + 'i)';
    h.appendChild(label);
    if (drawSet) {
      var hits = 0;
      g.numbers.forEach(function (n) { if (drawSet[n]) hits++; });
      var badge = document.createElement('span');
      badge.className = 'hits' + (hits >= 14 ? ' hits--top' : (hits === 13 ? ' hits--mid' : ''));
      badge.textContent = hits + ' pts';
      badge.title = hits + ' acertos neste concurso';
      h.appendChild(badge);
    }
    var mini = document.createElement('div');
    mini.className = 'mini';
    var on = {};
    g.numbers.forEach(function (n) { on[n] = true; });
    for (var n = 1; n <= E.TOTAL; n++) {
      var s = document.createElement('span');
      s.textContent = E.pad(n);
      if (on[n]) s.className = 'is-on';
      mini.appendChild(s);
    }
    card.appendChild(h);
    card.appendChild(mini);
    return card;
  }

  function renderResultados() {
    var gen = ensureGeneration();
    var empty = $('#resultados-vazio');
    var host = $('#games');
    var guarantee = $('#guarantee-card');
    var resumo = $('#resumo-geracao');
    var conf = $('#resumo-conferencia');

    empty.hidden = !!gen;
    host.innerHTML = '';
    $('#btn-salvar').disabled = !gen;
    $('#btn-exportar').disabled = !gen;

    if (!gen) {
      guarantee.hidden = true;
      conf.hidden = true;
      resumo.textContent = 'Com base nos números excluídos na etapa anterior, o sistema gerou as apostas abaixo.';
      return;
    }

    var pills = document.createElement('div');
    pills.className = 'resumo';
    var p1 = document.createElement('span');
    p1.className = 'pill';
    p1.innerHTML = 'Excluídas: <b>' + gen.excluded.map(E.pad).join(' · ') + '</b>';
    var p2 = document.createElement('span');
    p2.className = 'pill';
    p2.textContent = '24 apostas de 15 dezenas';
    pills.appendChild(p1);
    pills.appendChild(p2);
    resumo.textContent = 'Com base nos números excluídos na etapa anterior, o sistema gerou as apostas abaixo.';
    resumo.appendChild(pills);

    var row = currentRow();
    var drawSet = null;
    if (row) {
      drawSet = {};
      row[2].forEach(function (n) { drawSet[n] = true; });
    }
    gen.games.forEach(function (g) { host.appendChild(renderGameCard(g, drawSet)); });

    if (row) {
      var score = E.scoreGames(gen.games, row[2], prizesOf(row));
      var bal = E.balance(score, state.price);
      var parts = score.rows.filter(function (r) { return r.count > 0; })
        .map(function (r) { return r.count + '× ' + r.tier; });
      conf.hidden = false;
      conf.innerHTML = 'Conferência do concurso <strong>' + row[0] + '</strong> (' + row[1] + '): ' +
        (parts.length ? parts.join(' · ') : 'nenhuma aposta atingiu 11 pontos') +
        ' — prêmio ' + money(bal.prize) + ' · custo ' + money(bal.cost) +
        ' · saldo <strong class="' + (bal.profit >= 0 ? 'pos' : 'neg') + '">' +
        signedMoney(bal.profit) + '</strong>.';
    } else {
      conf.hidden = true;
    }

    guarantee.hidden = false;
    $('#guarantee-summary').textContent =
      'Se as 7 exclusões estiverem corretas, as 15 sorteadas ficam dentro do pool de 18. ' +
      'Toda aposta omite 3 dezenas do pool e cada dezena aparece em 20 das 24 apostas.';
    var list = $('#guarantee-list');
    list.innerHTML = '';
    [
      'Todas as 24 apostas fazem no mínimo 12 pontos.',
      'Pelo menos uma aposta faz 14 ou 15 pontos — sempre.',
      'Nenhuma aposta repete a combinação de outra.'
    ].forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      list.appendChild(li);
    });

    var body = $('#guarantee-body');
    body.innerHTML = '';
    [0, 1, 2, 3].forEach(function (k) {
      var tr = document.createElement('tr');
      var worst = E.worstCase(gen.games, gen.pool, k);
      tr.innerHTML = '<td>' + (k === 0 ? 'nenhuma' : k + (k === 1 ? ' dezena' : ' dezenas')) + '</td>' +
        '<td class="num">' + worst + ' pontos</td>';
      body.appendChild(tr);
    });
  }

  function saveGame() {
    var gen = state.generation;
    if (!gen) return;
    state.saved.unshift({
      id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
      excluded: gen.excluded.slice(),
      seed: gen.seed,
      concurso: state.concurso
    });
    saveState();
    toast('Jogo salvo em “Jogos salvos”.');
  }

  function exportGeneration(gen, concurso, excludedLabel) {
    var row = rowOf(concurso);
    var draw = drawOf(row);
    var score = row ? E.scoreGames(gen.games, row[2], prizesOf(row)) : null;
    var csv = E.toCSV(gen, draw, score, state.price);
    var base = excludedLabel ? 'lotofacil-' + excludedLabel : 'lotofacil-24-apostas';
    download(base + '-' + stamp() + '.csv', csv);
    toast('CSV gerado (abre no Excel).');
  }

  /* ---------------- salvos ---------------- */
  function renderSaved() {
    var host = $('#saved');
    var empty = $('#salvos-vazio');
    host.innerHTML = '';
    empty.hidden = state.saved.length > 0;

    state.saved.forEach(function (entry) {
      var card = document.createElement('article');
      card.className = 'saved-card';
      var h = document.createElement('h3');
      h.textContent = 'Fechamento de 24 apostas';
      var meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = 'Salvo em ' + formatDate(entry.createdAt) +
        ' · excluídas ' + entry.excluded.map(E.pad).join(' ') +
        ' · concurso ' + entry.concurso;
      var acts = document.createElement('div');
      acts.className = 'row-actions';

      function mkBtn(label, cls, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + cls;
        b.textContent = label;
        b.addEventListener('click', fn);
        return b;
      }

      acts.appendChild(mkBtn('Abrir', 'btn--ghost', function () {
        state.excluded = entry.excluded.slice();
        state.seed = entry.seed || 0;
        state.concurso = BY_CONCURSO[entry.concurso] ? entry.concurso : LATEST;
        state.generation = null;
        saveState();
        show('resultados');
      }));

      acts.appendChild(mkBtn('Exportar', 'btn--ghost', function () {
        try {
          var gen = E.buildGames(entry.excluded, { seed: entry.seed || 0 });
          exportGeneration(gen, entry.concurso, entry.excluded.map(E.pad).join('-'));
        } catch (err) {
          toast('Falha ao exportar: ' + err.message);
        }
      }));

      acts.appendChild(mkBtn('Excluir', 'btn--link', function () {
        if (!window.confirm('Excluir este jogo salvo?')) return;
        state.saved = state.saved.filter(function (g) { return g.id !== entry.id; });
        saveState();
        renderSaved();
        toast('Jogo excluído.');
      }));

      card.appendChild(h);
      card.appendChild(meta);
      card.appendChild(acts);
      host.appendChild(card);
    });
  }

  /* ---------------- tendências ---------------- */
  function buildChips() {
    var host = $('#window-chips');
    host.innerHTML = '';
    WINDOWS.forEach(function (w) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = String(w);
      b.dataset.window = String(w);
      b.setAttribute('aria-pressed', state.trends.window === w ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.trends.window = w;
        $$('#window-chips .chip').forEach(function (c) {
          c.setAttribute('aria-pressed', Number(c.dataset.window) === w ? 'true' : 'false');
        });
        saveState();
        renderTrendTable();
      });
      host.appendChild(b);
    });
  }

  function trendData() {
    if (!HISTORY.length) return null;
    var size = Math.min(state.trends.window, HISTORY.length);
    var window = HISTORY.slice(HISTORY.length - size);
    var freq = {};
    for (var i = 1; i <= E.TOTAL; i++) freq[i] = 0;
    window.forEach(function (row) {
      row[2].forEach(function (d) { freq[d]++; });
    });
    var ranks = Object.keys(freq).map(Number).sort(function (a, b) {
      return freq[b] - freq[a] || a - b;
    });
    var freqs = ranks.map(function (d) { return freq[d]; });
    return {
      window: window, freq: freq, ranks: ranks, size: size,
      hotCut: freqs[4],
      coldCut: freqs[E.TOTAL - 7]
    };
  }

  function renderTrends() {
    buildChips();
    var meta = $('#trend-base');
    if (meta) {
      var extras = HISTORY.filter(function (r) { return r[0] > STATIC_LATEST; }).length;
      meta.textContent = HISTORY.length
        ? 'Base real: ' + HISTORY.length + ' concursos (concurso 1 a ' + LATEST + '), atualizada em ' +
          (HISTORY_META.geradoEm || '—') + (extras ? ' + ' + extras + ' resultado(s) novo(s) incluído(s) automaticamente' : '') + '.'
        : 'Histórico indisponível.';
    }
    renderTrendTable();
  }

  function renderTrendTable() {
    var data = trendData();
    var host = $('#trend-results');
    if (!data) { host.hidden = true; return; }
    host.hidden = false;

    var first = data.window[0][0];
    var last = data.window[data.window.length - 1][0];
    $('#trend-summary').textContent = 'Janela: ' + data.size + ' concursos (' + first + ' a ' + last + ').';

    var body = $('#trend-body');
    body.innerHTML = '';
    for (var n = 1; n <= E.TOTAL; n++) {
      var tr = document.createElement('tr');
      var pct = data.freq[n] / data.size * 100;
      var label = data.freq[n] >= data.hotCut ? 'quente'
        : (data.freq[n] <= data.coldCut ? 'frio' : 'neutro');
      tr.innerHTML = '<td>' + E.pad(n) + '</td>' +
        '<td class="num">' + data.freq[n] + '</td>' +
        '<td class="num">' + pct.toFixed(0) + '%</td>' +
        '<td>' + label + '</td>';
      body.appendChild(tr);
    }

    var cold = data.ranks.slice(E.TOTAL - E.EXCLUDED_COUNT).sort(function (a, b) { return a - b; });
    state.trends.suggestion = cold;
    $('#suggestion').textContent = cold.map(E.pad).join(' · ');
    $('#btn-usar-sugestao').disabled = cold.length !== E.EXCLUDED_COUNT;
  }

  /* ---------------- inicialização ---------------- */
  function bind() {
    $$('#nav button').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.view); });
    });
    $$('[data-view]').forEach(function (el) {
      if (el.closest('#nav')) return;
      el.addEventListener('click', function (e) {
        e.preventDefault();
        show(el.dataset.view);
      });
    });

    $('#btn-refresh').addEventListener('click', function () { refreshLatest(true); });
    $('#btn-gerar').addEventListener('click', function () {
      if (!ensureGeneration()) { toast('Selecione as 7 dezenas.'); return; }
      show('resultados');
    });
    $('#btn-buscar').addEventListener('click', function () { applyConcurso($('#inp-concurso').value); });
    $('#inp-concurso').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applyConcurso(this.value); }
    });
    $('#inp-preco').addEventListener('change', function (e) {
      var v = parseFloat(e.target.value);
      state.price = isFinite(v) && v >= 0 ? v : 0;
      e.target.value = String(state.price);
      saveState();
      updateSimulation();
      renderResultados();
    });
    $('#btn-salvar').addEventListener('click', saveGame);
    $('#btn-ir-resultado').addEventListener('click', function () { show('criar'); });
    $('#btn-exportar').addEventListener('click', function () {
      var gen = state.generation;
      if (!gen) return;
      exportGeneration(gen, state.concurso, gen.excluded.map(E.pad).join('-'));
    });
    $('#btn-novo-padrao').addEventListener('click', function () {
      if (!state.generation) return;
      state.seed = (state.seed + 1) % 100000;
      state.generation = null;
      ensureGeneration();
      saveState();
      renderResultados();
      updateSimulation();
      toast('Novo padrão gerado com as mesmas garantias.');
    });
    $('#btn-usar-sugestao').addEventListener('click', function () {
      var sug = state.trends.suggestion;
      if (!sug || sug.length !== E.EXCLUDED_COUNT) return;
      state.excluded = sug.slice().sort(function (a, b) { return a - b; });
      state.generation = null;
      saveState();
      show('criar');
      toast('Sugestão aplicada. Revise as 7 dezenas antes de gerar.');
    });
  }

  function init() {
    loadState();
    loadExtras();
    bind();
    buildVolante();
    buildConcursoList();
    if (!BY_CONCURSO[state.concurso]) state.concurso = LATEST;
    if (state.excluded.length === E.EXCLUDED_COUNT) ensureGeneration();
    renderCriar();
    var initial = (location.hash || '').replace('#', '');
    show(VIEWS.indexOf(initial) >= 0 ? initial : 'inicio');
    refreshLatest(false);
    setInterval(function () {
      if (!document.hidden) refreshLatest(false);
    }, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - lastRefresh > 2 * 60 * 1000) refreshLatest(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
