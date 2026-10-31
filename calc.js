/* Cálculos da app (sem interface). Espelham as fórmulas do Excel:
 *  - totais por categoria / grupo / divisão da casa e média mensal («só meses com gasto»)
 *  - acerto de contas: pago do bolso + parte da conta conjunta − parte de cada um ± transferências
 * Também corre em Node (testes) para comparar com os valores do Excel. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var sum = function (list) { var t = 0; for (var i = 0; i < list.length; i++) t += list[i].v; return t; };
  // O Excel (SUMIFS) ignora maiúsculas/minúsculas; fazemos o mesmo.
  var same = function (a, b) { return !!b && String(a || '').toLowerCase() === String(b).toLowerCase(); };

  /** Junta ano (y) e mês (m) a cada despesa. Linhas sem data ficam com y = 0 (só contam em «tudo»). */
  function prep(list) {
    return list.map(function (e) {
      var y = 0, m = 0;
      if (e.d && e.d.length >= 7) { y = +e.d.slice(0, 4); m = +e.d.slice(5, 7); }
      return Object.assign({}, e, { y: y, m: m });
    });
  }

  /** year: número ou 'all'; month: 0 = ano todo. */
  function inPeriod(e, year, month) {
    if (year === 'all') return true;
    if (e.y !== year) return false;
    return !month || e.m === month;
  }
  function filterPeriod(list, year, month) { return list.filter(function (e) { return inPeriod(e, year, month); }); }

  function years(list) {
    var s = {};
    list.forEach(function (e) { if (e.y) s[e.y] = 1; });
    return Object.keys(s).map(Number).sort(function (a, b) { return b - a; });
  }

  /** Média mensal = total / nº de meses com gasto positivo (como o Excel). */
  function avgPerMonth(list) {
    var by = {}, total = 0;
    list.forEach(function (e) {
      if (!e.y) return;
      var k = e.y * 100 + e.m;
      by[k] = (by[k] || 0) + e.v; total += e.v;
    });
    var n = Object.keys(by).filter(function (k) { return by[k] > 0; }).length;
    return n ? total / n : 0;
  }
  function monthsWithSpend(list) {
    var by = {};
    list.forEach(function (e) { if (e.y) { var k = e.y * 100 + e.m; by[k] = (by[k] || 0) + e.v; } });
    return Object.keys(by).filter(function (k) { return by[k] > 0; }).length;
  }

  function groupOf(cfg, cat) { return (cfg.catGroups && cfg.catGroups[cat]) || ''; }

  /** Categorias da Config (por ordem) + «Sem categoria» para o que sobra. Só devolve com despesas. */
  function byCategory(list, cfg) {
    var out = [], known = {};
    cfg.cats.forEach(function (c) {
      known[c] = 1;
      var l = list.filter(function (e) { return e.c === c; });
      out.push({ name: c, group: groupOf(cfg, c), total: sum(l), count: l.length });
    });
    var rest = list.filter(function (e) { return !known[e.c]; });
    if (rest.length) out.push({ name: 'Sem categoria', group: '', total: sum(rest), count: rest.length, other: true });
    return out.filter(function (o) { return o.count > 0; });
  }

  /** Grupos da Config (por ordem, para a cor ser sempre a mesma) + «Sem grupo». */
  function byGroup(list, cfg) {
    var out = cfg.groups.map(function (g, i) {
      var l = list.filter(function (e) { return groupOf(cfg, e.c) === g; });
      return { name: g, idx: i, total: sum(l), count: l.length };
    });
    var rest = list.filter(function (e) { return cfg.groups.indexOf(groupOf(cfg, e.c)) < 0; });
    if (rest.length) out.push({ name: 'Sem grupo', idx: -1, total: sum(rest), count: rest.length, other: true });
    return out;
  }

  /** Divisões da casa + «Sem divisão indicada» (o resto, como no Excel). */
  function byRoom(list, cfg) {
    var out = [], used = 0;
    cfg.rooms.forEach(function (r) {
      var l = list.filter(function (e) { return e.h === r; });
      used += sum(l);
      out.push({ name: r, key: r, total: sum(l), count: l.length });
    });
    var rest = list.filter(function (e) { return cfg.rooms.indexOf(e.h) < 0; });
    out.push({ name: 'Sem divisão indicada', key: '', total: sum(rest), count: rest.length, other: true });
    return out.filter(function (o) { return o.count > 0; });
  }

  /** Total por mês (ano escolhido) ou por ano (year === 'all'), com o repartido por grupo. */
  function series(list, cfg, year) {
    var buckets = [];
    if (year === 'all') {
      years(list).slice().reverse().forEach(function (y) { buckets.push({ key: y, label: String(y), y: y, m: 0 }); });
    } else {
      for (var m = 1; m <= 12; m++) buckets.push({ key: m, label: '', y: year, m: m });
    }
    buckets.forEach(function (b) {
      var l = list.filter(function (e) { return b.m ? (e.y === b.y && e.m === b.m) : e.y === b.y; });
      b.total = sum(l); b.count = l.length;
      // sempre uma coluna por grupo da Config (mesma ordem = mesma cor) + o que sobra
      b.groups = cfg.groups.map(function (g) { return sum(l.filter(function (e) { return groupOf(cfg, e.c) === g; })); });
      b.rest = b.total - b.groups.reduce(function (a, v) { return a + v; }, 0);
    });
    return buckets;
  }

  /** Total por mês de uma categoria (para o gráfico de evolução). */
  function catSeries(list, cat, year) {
    var out = [];
    for (var m = 1; m <= 12; m++) out.push(sum(list.filter(function (e) { return e.c === cat && e.y === year && e.m === m; })));
    return out;
  }

  /** Quem pagou: conta conjunta (tudo o que não é pago por uma das pessoas), pessoa 1, pessoa 2. */
  function payerSplit(list, cfg) {
    var p1 = list.filter(function (e) { return same(e.p, cfg.p1); });
    var p2 = list.filter(function (e) { return same(e.p, cfg.p2); });
    var jt = list.filter(function (e) { return !same(e.p, cfg.p1) && !same(e.p, cfg.p2); });
    return [
      { key: 'joint', name: cfg.joint, total: sum(jt), count: jt.length },
      { key: 'p1', name: cfg.p1, total: sum(p1), count: p1.length },
      { key: 'p2', name: cfg.p2, total: sum(p2), count: p2.length }
    ];
  }

  /** Acerto de contas acumulado (todas as despesas e transferências). */
  function settle(exp, tr, cfg) {
    var total = sum(exp);
    var d1 = sum(exp.filter(function (e) { return same(e.p, cfg.p1); }));
    var d2 = sum(exp.filter(function (e) { return same(e.p, cfg.p2); }));
    var joint = total - d1 - d2;
    var only1 = sum(exp.filter(function (e) { return same(e.x, cfg.splitP1); }));
    var only2 = sum(exp.filter(function (e) { return same(e.x, cfg.splitP2); }));
    var shared = total - only1 - only2;
    var f1 = cfg.fund1, q1 = cfg.pct1;
    var jp1 = joint * f1, jp2 = joint * (1 - f1);
    var paid1 = d1 + jp1, paid2 = d2 + jp2;
    var part1 = only1 + shared * q1, part2 = only2 + shared * (1 - q1);
    var diff1 = paid1 - part1, diff2 = paid2 - part2;
    var recv1 = sum(tr.filter(function (t) { return same(t.t, cfg.p1); }));
    var recv2 = sum(tr.filter(function (t) { return same(t.t, cfg.p2); }));
    var sent1 = sum(tr.filter(function (t) { return same(t.f, cfg.p1); }));
    var sent2 = sum(tr.filter(function (t) { return same(t.f, cfg.p2); }));
    var net1 = diff1 - recv1 + sent1, net2 = diff2 - recv2 + sent2;
    var value = r2(Math.abs(net1));
    var quits = Math.abs(net1) < 0.005;
    return {
      total: total, joint: joint, shared: shared,
      rows: {
        direct: [d1, d2], jointShare: [jp1, jp2], paid: [paid1, paid2], only: [only1, only2],
        part: [part1, part2], diff: [diff1, diff2], recv: [recv1, recv2], sent: [sent1, sent2], net: [net1, net2]
      },
      quits: quits,
      from: quits ? '' : (net1 > 0 ? cfg.p2 : cfg.p1),
      to: quits ? '' : (net1 > 0 ? cfg.p1 : cfg.p2),
      value: quits ? 0 : value,
      text: quits ? 'Estão quites' : (net1 > 0 ? cfg.p2 + ' deve a ' + cfg.p1 : cfg.p1 + ' deve a ' + cfg.p2)
    };
  }

  /** Saldo de um mês (sem transferências), como a tabela «Mês a mês» do Excel. Positivo = pessoa 2 deve à pessoa 1. */
  function settleMonth(exp, cfg, year, m) {
    var l = exp.filter(function (e) { return e.y === year && e.m === m; });
    var total = sum(l);
    var d1 = sum(l.filter(function (e) { return same(e.p, cfg.p1); }));
    var d2 = sum(l.filter(function (e) { return same(e.p, cfg.p2); }));
    var only1 = sum(l.filter(function (e) { return same(e.x, cfg.splitP1); }));
    var only2 = sum(l.filter(function (e) { return same(e.x, cfg.splitP2); }));
    var joint = total - d1 - d2;
    var part1 = only1 + (total - only1 - only2) * cfg.pct1;
    return { total: total, count: l.length, net1: d1 + joint * cfg.fund1 - part1 };
  }

  return {
    r2: r2, sum: sum, same: same, prep: prep, inPeriod: inPeriod, filterPeriod: filterPeriod, years: years,
    avgPerMonth: avgPerMonth, monthsWithSpend: monthsWithSpend, groupOf: groupOf,
    byCategory: byCategory, byGroup: byGroup, byRoom: byRoom, series: series, catSeries: catSeries,
    payerSplit: payerSplit, settle: settle, settleMonth: settleMonth
  };
});
