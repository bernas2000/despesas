/* Cálculos da app (sem interface). Espelham as fórmulas do Excel:
 *  - totais por categoria / grupo / divisão da casa e média mensal («só meses com gasto»)
 *  - acerto de contas: pago do bolso + parte da conta conjunta − parte de cada um ± transferências
 *    (a conta conjunta é dos dois: pagar por ela não cria dívida, seja qual for o valor que cada um deposita)
 *  - gastos pessoais (categorias «pessoais», sempre pagos por e só de uma pessoa): ficam fora da casa e das dívidas
 *  - orçamento: gasto corrente vs. o que entra por mês na conta conjunta
 *  - por pessoa: ordenado médio (12 ou 14 pagamentos) − entrada na conjunta − casa paga do bolso − gastos pessoais = sobra
 *  - saldo estimado da conta conjunta a partir de um saldo de referência
 * Também corre em Node (testes) para comparar com os valores do Excel. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // «meio cêntimo para cima» sem erros de vírgula flutuante (368,075 → 368,08, como o Excel)
  var r2 = function (v) { return (v < 0 ? -1 : 1) * Math.round((Math.abs(v) + 1e-9) * 100) / 100; };
  var sum = function (list) { var t = 0; for (var i = 0; i < list.length; i++) t += list[i].v; return t; };
  // O Excel (SUMIFS) ignora maiúsculas/minúsculas; fazemos o mesmo.
  var same = function (a, b) { return !!b && String(a || '').toLowerCase() === String(b).toLowerCase(); };

  /** De quem é um gasto pessoal: 1 ou 2 (0 = não é pessoal). O dono é quem aparece em «Só X»; sem isso, quem pagou.
   *  Sem pagador (conta conjunta) conta como despesa da casa, para não desaparecer. */
  function ownerOf(e, cfg) {
    if (!cfg || !cfg.pcats || cfg.pcats.indexOf(e.c) < 0) return 0;
    var payer = same(e.p, cfg.p1) ? 1 : same(e.p, cfg.p2) ? 2 : 0;
    if (!payer) return 0;
    if (same(e.x, cfg.splitP1)) return 1;
    if (same(e.x, cfg.splitP2)) return 2;
    return payer;
  }
  function isPersonal(e, cfg) { return ownerOf(e, cfg) > 0; }
  function houseOf(list, cfg) { return cfg && cfg.pcats ? list.filter(function (e) { return !isPersonal(e, cfg); }) : list; }
  /** Gastos pessoais (de uma pessoa k, se indicada). */
  function personalOf(list, cfg, k) {
    return cfg && cfg.pcats ? list.filter(function (e) { var o = ownerOf(e, cfg); return o > 0 && (!k || o === k); }) : [];
  }
  /** O que conta para as dívidas: a casa + os gastos pessoais pagos pelo outro (o dono fica a dever). */
  function debtOf(list, cfg) {
    if (!cfg || !cfg.pcats) return list;
    return list.filter(function (e) {
      var o = ownerOf(e, cfg);
      return o === 0 || o !== (same(e.p, cfg.p1) ? 1 : 2);
    });
  }

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
    exp = debtOf(exp, cfg);
    var total = sum(exp);
    var d1 = sum(exp.filter(function (e) { return same(e.p, cfg.p1); }));
    var d2 = sum(exp.filter(function (e) { return same(e.p, cfg.p2); }));
    var joint = total - d1 - d2;
    var only1 = sum(exp.filter(function (e) { return same(e.x, cfg.splitP1); }));
    var only2 = sum(exp.filter(function (e) { return same(e.x, cfg.splitP2); }));
    var shared = total - only1 - only2;
    // A conta conjunta é dos dois: a parte de cada um nela é a mesma quota das despesas partilhadas,
    // por isso pagar pela conta conjunta nunca cria dívida (quanto cada um deposita não conta aqui).
    var q1 = cfg.pct1;
    var jp1 = joint * q1, jp2 = joint * (1 - q1);
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
    var l = debtOf(exp, cfg).filter(function (e) { return e.y === year && e.m === m; });
    var total = sum(l);
    var d1 = sum(l.filter(function (e) { return same(e.p, cfg.p1); }));
    var d2 = sum(l.filter(function (e) { return same(e.p, cfg.p2); }));
    var only1 = sum(l.filter(function (e) { return same(e.x, cfg.splitP1); }));
    var only2 = sum(l.filter(function (e) { return same(e.x, cfg.splitP2); }));
    var joint = total - d1 - d2;
    var part1 = only1 + (total - only1 - only2) * cfg.pct1;
    return { total: total, count: l.length, net1: d1 + joint * cfg.pct1 - part1 };
  }

  /* ---------- orçamento e poupança ---------- */

  function daysIn(y, m) { return new Date(y, m, 0).getDate(); }

  /** Grupos tratados como «compras pontuais» (mobília…): ficam fora do orçamento mensal corrente.
   *  bud.oneoff = máscara de bits sobre cfg.groups; sem valor guardado, usa os grupos com «mob» no nome. */
  function oneoffGroups(cfg, bud) {
    var m = bud && typeof bud.oneoff === 'number' ? bud.oneoff : null;
    return cfg.groups.filter(function (g, i) {
      return m === null ? /mob/i.test(g) : ((m >> i) & 1) === 1;
    });
  }

  /**
   * Indicadores do orçamento. today = 'aaaa-mm-dd'.
   *  - só conta o gasto «corrente» (fora das compras pontuais);
   *  - médias: meses completos com gasto (se ainda não houver, usa os que existirem).
   */
  function budget(exp, bud, cfg, today) {
    bud = bud || {};
    exp = houseOf(exp, cfg);
    var num = function (k) { var v = bud[k]; return typeof v === 'number' && isFinite(v) ? v : null; };
    var in1 = num('in1'), in2 = num('in2'), bal = num('bal');
    var inc1 = incomeOf(bud, 1), inc2 = incomeOf(bud, 2);
    var monthly = (in1 || 0) + (in2 || 0);
    var oneoff = oneoffGroups(cfg, bud);
    var isOne = function (e) { return oneoff.indexOf(groupOf(cfg, e.c)) >= 0; };
    var run = exp.filter(function (e) { return e.y && !isOne(e); });
    var one = exp.filter(function (e) { return e.y && isOne(e); });
    var ty = +today.slice(0, 4), tm = +today.slice(5, 7), td = +today.slice(8, 10);
    var curKey = ty * 100 + tm;

    var by = {};
    run.forEach(function (e) { var k = e.y * 100 + e.m; by[k] = (by[k] || 0) + e.v; });
    // só meses que já começaram (despesas com data futura não entram nos indicadores)
    var months = Object.keys(by).map(Number).filter(function (k) { return k <= curKey; }).sort(function (a, b) { return a - b; }).map(function (k) {
      return { key: k, y: Math.floor(k / 100), m: k % 100, v: by[k], over: monthly > 0 && by[k] > monthly + 0.005, current: k === curKey };
    });
    var spentNow = by[curKey] || 0;
    var oneNow = sum(one.filter(function (e) { return e.y === ty && e.m === tm; }));
    var base = months.filter(function (x) { return x.key < curKey && x.v > 0; });
    if (!base.length) base = months.filter(function (x) { return x.v > 0; });
    var avg = base.length ? base.reduce(function (a, x) { return a + x.v; }, 0) / base.length : 0;

    var dayFrac = td / daysIn(ty, tm);
    var status = null;
    if (monthly > 0) status = spentNow > monthly + 0.005 ? 'over' : (spentNow > monthly * dayFrac + 0.005 ? 'pace' : 'ok');

    var hasSal = inc1 !== null && inc2 !== null && inc1 + inc2 > 0;
    var income = hasSal ? inc1 + inc2 : null;
    var est = jointEstimate(exp, bud, cfg, today);
    return {
      has: monthly > 0, monthly: monthly, in1: in1, in2: in2,
      share: monthly > 0 && in1 !== null && in2 !== null ? [in1 / monthly, in2 / monthly] : null,
      oneoff: oneoff, months: months, spentNow: spentNow, oneNow: oneNow, left: monthly - spentNow,
      used: monthly > 0 ? spentNow / monthly : null, dayFrac: dayFrac, status: status,
      avg: avg, avgN: base.length, overCount: months.filter(function (x) { return x.over && x.key < curKey; }).length,
      doneMonths: months.filter(function (x) { return x.key < curKey; }).length,
      hasSal: hasSal, income: income,
      incShare: hasSal ? [inc1 / income, inc2 / income] : null,
      fair: hasSal && monthly > 0 ? [monthly * inc1 / income, monthly * inc2 / income] : null,
      inPct: hasSal && in1 !== null && in2 !== null ? [inc1 > 0 ? in1 / inc1 : null, inc2 > 0 ? in2 / inc2 : null] : null,
      homeRate: hasSal && monthly > 0 ? monthly / income : null,
      bal: bal, balDate: typeof bud.balDate === 'string' ? bud.balDate : '',
      est: est, balNow: est ? est.est : bal,
      cover: est && avg > 0 ? est.est / avg : (bal !== null && avg > 0 ? bal / avg : null)
    };
  }

  /* ---------- rendimento, sobra de cada pessoa e saldo da conta conjunta ---------- */

  /** Ordenado médio por mês: ordenado de um mês normal × pagamentos por ano (12 ou 14) ÷ 12. */
  function incomeOf(bud, k) {
    var sal = bud && typeof bud['sal' + k] === 'number' && isFinite(bud['sal' + k]) ? bud['sal' + k] : null;
    if (sal === null) return null;
    var pay = bud['pay' + k] === 14 ? 14 : 12;
    return sal * pay / 12;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * Saldo estimado da conta conjunta: saldo de referência (bud.bal na data bud.balDate)
   * + entradas mensais que já aconteceram desde então (no dia bud.inDay, por omissão 1)
   * − despesas pagas pela conta conjunta desde então (só as com data de depois da referência e até hoje).
   * Devolve null sem saldo de referência.
   */
  function jointEstimate(exp, bud, cfg, today) {
    bud = bud || {};
    var bal = typeof bud.bal === 'number' && isFinite(bud.bal) ? bud.bal : null;
    var bd = typeof bud.balDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bud.balDate) ? bud.balDate : '';
    if (bal === null || !bd) return null;
    var in1 = typeof bud.in1 === 'number' ? bud.in1 : 0, in2 = typeof bud.in2 === 'number' ? bud.in2 : 0;
    var monthly = in1 + in2;
    var day = typeof bud.inDay === 'number' && bud.inDay >= 1 && bud.inDay <= 28 ? Math.floor(bud.inDay) : 1;
    var y = +bd.slice(0, 4), m = +bd.slice(5, 7), ty = +today.slice(0, 4), tm = +today.slice(5, 7), n = 0;
    while (y * 12 + m <= ty * 12 + tm && n < 600) {
      var ds = y + '-' + pad2(m) + '-' + pad2(day);
      if (ds > bd && ds <= today) n++;
      m++; if (m > 12) { m = 1; y++; }
    }
    var spent = sum(houseOf(exp, cfg).filter(function (e) {
      return !same(e.p, cfg.p1) && !same(e.p, cfg.p2) && e.d && e.d > bd && e.d <= today;
    }));
    var contrib = n * monthly;
    return { est: r2(bal + contrib - spent), bal: bal, balDate: bd, n: n, contrib: contrib, spent: spent, monthly: monthly, day: day };
  }

  /**
   * A situação de uma pessoa (k = 1 ou 2), em médias mensais:
   *   ordenado − entrada na conta conjunta − casa paga do bolso (a sua parte, depois de acertar contas) − gastos pessoais = sobra.
   * Só entram meses já começados e a casa corrente (as compras pontuais ficam de fora, como no orçamento).
   * Cada média usa os meses em que há movimento desse tipo, para não puxar a sobra para cima por falta de registos.
   * exp = TODAS as despesas (casa + pessoais).
   */
  function person(exp, bud, cfg, today, k) {
    bud = bud || {};
    var name = k === 1 ? cfg.p1 : cfg.p2, q = k === 1 ? cfg.pct1 : 1 - cfg.pct1;
    var income = incomeOf(bud, k);
    var contrib = typeof bud['in' + k] === 'number' ? bud['in' + k] : null;
    var oneoff = oneoffGroups(cfg, bud);
    var ty = +today.slice(0, 4), tm = +today.slice(5, 7), curKey = ty * 100 + tm;
    var mine = personalOf(exp, cfg, k).filter(function (e) { return e.y; });
    var house = houseOf(exp, cfg).filter(function (e) { return e.y && oneoff.indexOf(groupOf(cfg, e.c)) < 0; });

    var pers = {}, oop = {}, hmonth = {};
    mine.forEach(function (e) { var key = e.y * 100 + e.m; pers[key] = (pers[key] || 0) + e.v; });
    house.forEach(function (e) { var key = e.y * 100 + e.m; (hmonth[key] = hmonth[key] || []).push(e); });
    Object.keys(hmonth).forEach(function (key) {
      var l = hmonth[key], total = sum(l);
      var d1 = sum(l.filter(function (e) { return same(e.p, cfg.p1); })), d2 = sum(l.filter(function (e) { return same(e.p, cfg.p2); }));
      var joint = total - d1 - d2;
      var o1 = sum(l.filter(function (e) { return same(e.x, cfg.splitP1); })), o2 = sum(l.filter(function (e) { return same(e.x, cfg.splitP2); }));
      var shared = total - o1 - o2, q1 = cfg.pct1;
      var part = k === 1 ? o1 + shared * q1 : o2 + shared * (1 - q1);
      var jp = joint * (k === 1 ? q1 : 1 - q1);
      oop[key] = part - jp;
    });
    var avgOf = function (map) {
      var keys = Object.keys(map).map(Number).filter(function (x) { return x <= curKey; });
      var done = keys.filter(function (x) { return x < curKey; });
      var base = done.length ? done : keys;
      return { avg: base.length ? base.reduce(function (a, x) { return a + map[x]; }, 0) / base.length : 0, n: base.length };
    };
    var pa = avgOf(pers), oa = avgOf(oop);
    var hasInc = income !== null && contrib !== null;
    var base = hasInc ? income - contrib : null;
    var left = hasInc ? base - oa.avg - pa.avg : null;

    var keys = Object.keys(pers).map(Number).filter(function (x) { return x <= curKey; }).sort(function (a, b) { return a - b; });
    var months = keys.map(function (key) {
      var o = oop[key] || 0;
      return { key: key, y: Math.floor(key / 100), m: key % 100, pers: pers[key], oop: o, left: hasInc ? base - o - pers[key] : null, current: key === curKey };
    });
    return {
      k: k, name: name, income: income, sal: typeof bud['sal' + k] === 'number' ? bud['sal' + k] : null, pay: bud['pay' + k] === 14 ? 14 : 12,
      contrib: contrib, hasInc: hasInc,
      persAvg: pa.avg, persN: pa.n, oopAvg: oa.avg, oopN: oa.n, hasPers: pa.n > 0,
      persNow: pers[curKey] || 0, left: left, rate: hasInc && income > 0 ? left / income : null,
      months: months
    };
  }

  return {
    r2: r2, sum: sum, same: same, prep: prep, inPeriod: inPeriod, filterPeriod: filterPeriod, years: years,
    avgPerMonth: avgPerMonth, monthsWithSpend: monthsWithSpend, groupOf: groupOf,
    byCategory: byCategory, byGroup: byGroup, byRoom: byRoom, series: series, catSeries: catSeries,
    payerSplit: payerSplit, settle: settle, settleMonth: settleMonth, oneoffGroups: oneoffGroups, budget: budget,
    isPersonal: isPersonal, ownerOf: ownerOf, houseOf: houseOf, personalOf: personalOf, debtOf: debtOf, incomeOf: incomeOf, jointEstimate: jointEstimate, person: person
  };
});
