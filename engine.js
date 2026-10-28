/*
 * LotoFácil — fechamento "7 excluídas → 24 apostas de 15 dezenas"
 *
 * Ideia central (dualidade jogo ↔ trio omitido):
 *   Universo = 25 dezenas. O usuário exclui 7 → sobram 18 (o "pool").
 *   Cada aposta tem 15 dezenas do pool, ou seja, omite exatamente 3 do pool.
 *   Logo, escolher 24 apostas = escolher 24 trios distintos dentro do pool.
 *
 * Desenho usado (garantia matemática, não heurística):
 *   O pool é dividido em dois grupos de 9. Em cada grupo aplicamos o plano
 *   afim AG(2,3) — 12 retas de 3 pontos, onde cada par de pontos aparece em
 *   exatamente 1 reta e cada ponto em exatamente 4 retas (STS(9)).
 *   Resultado: 24 trios, cada dezena do pool omitida 4x (aparece em 20 jogos),
 *   os 72 pares internos cobertos 1x e a garantia de que todo trio de dezenas
 *   "não sorteadas" contém um par nosso → sempre há aposta com >= 14 pontos
 *   quando as 7 exclusões estão corretas.
 *
 * Nada aqui prevê sorteio: o sistema estrutura cobertura, não aumenta o valor
 * esperado de nenhuma aposta.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LotoEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TOTAL = 25;
  var EXCLUDED_COUNT = 7;
  var GAME_SIZE = 15;
  var GAMES_COUNT = 24;
  var TIERS = [15, 14, 13, 12, 11];
  var PRIZE_DEFAULT = { 11: 6, 12: 12, 13: 30, 14: 1500, 15: 1700000 };

  /* ---------- PRNG determinístico ---------- */
  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /* ---------- desenho base: 12 retas de AG(2,3) sobre 0..8 ---------- */
  function baseLines() {
    var seen = {};
    var out = [];
    function add(pts) {
      var key = pts.slice().sort(function (a, b) { return a - b; }).join('-');
      if (!seen[key]) { seen[key] = true; out.push(key.split('-').map(Number)); }
    }
    // retas y = m*x + b (m, b em Z3)
    for (var m = 0; m < 3; m++) {
      for (var b = 0; b < 3; b++) {
        add([0, 1, 2].map(function (x) { return 3 * x + ((m * x + b) % 3); }));
      }
    }
    // retas verticais x = c
    for (var c = 0; c < 3; c++) {
      add([0, 1, 2].map(function (y) { return 3 * c + y; }));
    }
    return out; // 12 trios
  }

  var BASE_LINES = baseLines();

  /* ---------- validação ---------- */
  function validateExcluded(list) {
    var seen = {};
    var dup = [];
    var invalid = [];
    var nums = [];
    (list || []).forEach(function (n) {
      if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < 1 || n > TOTAL) {
        invalid.push(n);
      } else if (seen[n]) {
        dup.push(n);
      } else {
        seen[n] = true;
        nums.push(n);
      }
    });
    nums.sort(function (a, b) { return a - b; });
    var errors = [];
    if (invalid.length) errors.push('Dezenas fora do intervalo 1–' + TOTAL + ': ' + invalid.join(', '));
    if (dup.length) errors.push('Dezenas repetidas: ' + dup.join(', '));
    if (nums.length !== EXCLUDED_COUNT) {
      errors.push('Escolha exatamente ' + EXCLUDED_COUNT + ' dezenas (selecionadas: ' + nums.length + ').');
    }
    return { ok: errors.length === 0, errors: errors, numbers: nums };
  }

  function poolFrom(excluded) {
    var ex = {};
    excluded.forEach(function (n) { ex[n] = true; });
    var pool = [];
    for (var n = 1; n <= TOTAL; n++) if (!ex[n]) pool.push(n);
    return pool;
  }

  /* ---------- geração ---------- */
  function triosFor(pool, seed) {
    var rnd = mulberry32((hashSeed('lf|' + seed) ^ hashSeed(pool.join(','))) >>> 0);
    var labels = shuffle(pool.slice(), rnd);
    var groups = [labels.slice(0, 9), labels.slice(9, 18)];
    var trios = [];
    groups.forEach(function (g) {
      BASE_LINES.forEach(function (line) {
        trios.push(line.map(function (i) { return g[i]; }).sort(function (a, b) { return a - b; }));
      });
    });
    return trios;
  }

  /**
   * Gera 24 apostas de 15 dezenas a partir das 7 excluídas.
   * @param {number[]} excluded
   * @param {{seed?:number}} [opts]
   */
  function buildGames(excluded, opts) {
    var v = validateExcluded(excluded);
    if (!v.ok) {
      var err = new Error(v.errors.join(' '));
      err.validation = v;
      throw err;
    }
    var seed = (opts && opts.seed) || 0;
    var pool = poolFrom(v.numbers);
    var trios = triosFor(pool, seed);
    if (trios.length !== GAMES_COUNT) throw new Error('desenho inconsistente: ' + trios.length + ' trios');

    var appearances = {};
    pool.forEach(function (n) { appearances[n] = 0; });

    var games = trios.map(function (trio, i) {
      var skip = {};
      trio.forEach(function (n) { skip[n] = true; });
      var numbers = pool.filter(function (n) { return !skip[n]; });
      numbers.forEach(function (n) { appearances[n]++; });
      return { index: i + 1, trio: trio, numbers: numbers };
    });

    // invariantes do desenho (falha alto se alguém alterar o construtor)
    if (new Set(games.map(function (g) { return g.numbers.join(','); })).size !== GAMES_COUNT) {
      throw new Error('apostas duplicadas no desenho');
    }
    games.forEach(function (g) {
      if (g.numbers.length !== GAME_SIZE) throw new Error('aposta com tamanho inválido');
      if (g.numbers.some(function (n) { return v.numbers.indexOf(n) !== -1; })) {
        throw new Error('aposta contém dezena excluída');
      }
    });

    return {
      excluded: v.numbers.slice(),
      pool: pool,
      seed: seed,
      games: games,
      appearances: appearances,
      minAppearances: Math.min.apply(null, pool.map(function (n) { return appearances[n]; })),
      maxAppearances: Math.max.apply(null, pool.map(function (n) { return appearances[n]; }))
    };
  }

  /* ---------- pontuação ---------- */
  function scoreGames(games, draw, prizes) {
    var table = prizes || PRIZE_DEFAULT;
    var drawSet = {};
    (draw || []).forEach(function (n) { drawSet[n] = true; });
    var counts = {};
    TIERS.forEach(function (t) { counts[t] = 0; });
    var best = 0, worst = 99;

    games.forEach(function (g) {
      var hits = 0;
      g.numbers.forEach(function (n) { if (drawSet[n]) hits++; });
      if (counts[hits] !== undefined) counts[hits]++;
      if (hits > best) best = hits;
      if (hits < worst) worst = hits;
    });

    var rows = TIERS.map(function (t) {
      var q = counts[t] || 0;
      var unit = table[t] || 0;
      return { tier: t, count: q, unit: unit, subtotal: q * unit };
    });

    return {
      rows: rows,
      totalGames: games.length,
      totalPrize: rows.reduce(function (s, r) { return s + r.subtotal; }, 0),
      best: best,
      worst: worst,
      counts: counts
    };
  }

  function parity(numbers) {
    var odds = 0;
    numbers.forEach(function (n) { if (n % 2 === 1) odds++; });
    return { odds: odds, evens: numbers.length - odds };
  }

  /** Custo, prêmio e saldo (lucro/prejuízo) de um conjunto de apostas. */
  function balance(score, unitPrice) {
    var cost = score.totalGames * (unitPrice || 0);
    return { cost: cost, prize: score.totalPrize, profit: score.totalPrize - cost };
  }

  /** Converte [15,14,13,12,11] (dados da Caixa) no mapa usado por scoreGames. */
  function prizeMap(values) {
    var map = {};
    [15, 14, 13, 12, 11].forEach(function (tier, i) { map[tier] = values && values[i] != null ? values[i] : 0; });
    return map;
  }

  /* ---------- pior caso (garantia) ---------- */
  function forEachCombination(pool, size, cb) {
    var idx = [];
    (function rec(start, depth) {
      if (depth === size) { cb(idx.map(function (i) { return pool[i]; })); return; }
      for (var i = start; i <= pool.length - (size - depth); i++) {
        idx[depth] = i;
        rec(i + 1, depth + 1);
      }
    })(0, 0);
  }

  /**
   * Pior "melhor acerto" entre todas as combinações possíveis de dezenas
   * não sorteadas dentro do pool, com k das 7 excluídas tendo saído.
   * k=0 → 14 (garantia de 14 pontos em ao menos uma aposta).
   */
  function worstCase(games, pool, k) {
    var size = 3 + k;
    var worst = Infinity;
    forEachCombination(pool, size, function (N) {
      var set = {};
      N.forEach(function (n) { set[n] = true; });
      var best = 0;
      games.forEach(function (g) {
        var inter = 0;
        g.trio.forEach(function (n) { if (set[n]) inter++; });
        var score = 12 - k + inter;
        if (score > best) best = score;
      });
      if (best < worst) worst = best;
    });
    return worst;
  }

  /* ---------- utilidades ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function formatBRL(v) {
    return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseDrawText(text) {
    var nums = String(text || '').match(/\d{1,2}/g) || [];
    var out = [];
    var seen = {};
    nums.forEach(function (s) {
      var n = parseInt(s, 10);
      if (n >= 1 && n <= TOTAL && !seen[n]) { seen[n] = true; out.push(n); }
    });
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  /** CSV compatível com Excel pt-BR (BOM + separador ';'). */
  function toCSV(generation, draw, score, unitPrice) {
    var lines = [];
    lines.push('Fechamento LotoFácil - ' + GAMES_COUNT + ' apostas de ' + GAME_SIZE + ' dezenas');
    lines.push('Excluídas: ' + generation.excluded.map(pad).join(' '));
    if (draw && draw.dezenas && draw.dezenas.length) {
      lines.push('Concurso: ' + (draw.concurso || '-') + (draw.data ? ' - ' + draw.data : ''));
      lines.push('Resultado: ' + draw.dezenas.map(pad).join(' '));
    }
    lines.push('');
    var header = ['Jogo'];
    for (var i = 1; i <= GAME_SIZE; i++) header.push('D' + i);
    header.push('Pares', 'Impares');
    if (score) header.push('Acertos');
    lines.push(header.join(';'));
    generation.games.forEach(function (g) {
      var row = [g.index].concat(g.numbers.map(pad));
      var p = parity(g.numbers);
      row.push(p.evens, p.odds);
      if (score) {
        var hits = 0;
        var drawSet = {};
        draw.dezenas.forEach(function (n) { drawSet[n] = true; });
        g.numbers.forEach(function (n) { if (drawSet[n]) hits++; });
        row.push(hits);
      }
      lines.push(row.join(';'));
    });
    if (score) {
      lines.push('');
      score.rows.forEach(function (r) {
        lines.push(r.tier + ' pontos;' + r.count + ';' + formatBRL(r.subtotal));
      });
      lines.push('Total;' + score.totalGames + ';' + formatBRL(score.totalPrize));
      if (unitPrice != null) {
        var bal = balance(score, unitPrice);
        lines.push('Custo (' + score.totalGames + ' x ' + formatBRL(unitPrice) + ');' + formatBRL(bal.cost));
        lines.push('Saldo;' + formatBRL(bal.profit));
      }
    }
    return '\uFEFF' + lines.join('\r\n');
  }

  return {
    TOTAL: TOTAL,
    EXCLUDED_COUNT: EXCLUDED_COUNT,
    GAME_SIZE: GAME_SIZE,
    GAMES_COUNT: GAMES_COUNT,
    TIERS: TIERS,
    PRIZE_DEFAULT: PRIZE_DEFAULT,
    BASE_LINES: BASE_LINES,
    hashSeed: hashSeed,
    validateExcluded: validateExcluded,
    poolFrom: poolFrom,
    triosFor: triosFor,
    buildGames: buildGames,
    scoreGames: scoreGames,
    parity: parity,
    balance: balance,
    prizeMap: prizeMap,
    worstCase: worstCase,
    parseDrawText: parseDrawText,
    formatBRL: formatBRL,
    pad: pad,
    toCSV: toCSV
  };
});
