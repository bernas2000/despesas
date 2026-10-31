/* Despesas da casa – app (interface). Os cálculos estão em calc.js. */
(function () {
  'use strict';

  var STORE = 'despesas.cfg.v1';       // ligação (não mudar: os telemóveis já ligados continuam ligados)
  var CACHE = 'despesas.cache.v1';     // últimos dados, para abrir já com números
  var UIKEY = 'despesas.ui.v1';        // aspeto (tema, cor)
  var BGKEY = 'despesas.bg.v1';        // foto de fundo escolhida neste telemóvel
  var URL_OK = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var MS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var ACCENTS = [
    { id: 'navy', n: 'Azul-marinho', l: '#1f3864', d: '#7fa6e8' },
    { id: 'blue', n: 'Azul', l: '#1d5fbf', d: '#8ab4f8' },
    { id: 'teal', n: 'Turquesa', l: '#0b7a75', d: '#5fd0c8' },
    { id: 'green', n: 'Verde', l: '#2e7d32', d: '#7ed08a' },
    { id: 'violet', n: 'Violeta', l: '#6d3fd0', d: '#b79cff' },
    { id: 'rose', n: 'Rosa', l: '#be185d', d: '#f58ab6' },
    { id: 'orange', n: 'Laranja', l: '#b45309', d: '#f2a65a' }
  ];

  var CFG = null;     // ligação: { u: endereço do servidor, t: código }
  var conf = null;    // configuração da folha (categorias, pessoas, quotas…)
  var st = {
    exp: [], tr: [], loaded: false, legacy: false, serverV: 0, fetchedAt: 0, loadErr: '', tab: 'add',
    dash: { year: null, month: 0, evo: null, slots: {}, tableA: false, tableE: false, allCats: false },
    list: { q: '', year: 'all', month: 0, cat: '', payer: '', limit: 40 },
    debt: { year: null }
  };
  var ui = { theme: 'auto', accent: 'navy' };
  var busy = false;

  /* ====================== utilitários ====================== */

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function h(tag, a) {
    var el = document.createElement(tag);
    if (a) Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }

  var nf2 = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  var nf0 = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0, useGrouping: 'always' });
  function z(v) { return Math.abs(v) < 0.005 ? 0 : v; }
  // Arredonda «meio cêntimo para cima» sem erros de vírgula flutuante (368,075 → 368,08, nos dois sinais).
  function rnd(v, k) { return (v < 0 ? -1 : 1) * Math.round((Math.abs(v) + 1e-9) * k) / k; }
  function money(v) { return nf2.format(z(rnd(v, 100))) + '\u00a0€'; }
  function money0(v) { var r = rnd(v, 1); return nf0.format(r === 0 ? 0 : r) + '\u00a0€'; }
  function pct(v) { return Math.round(v * 100) + '%'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function parseNum(s) {
    s = String(s).replace(/[\s€]/g, '');
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
  }
  function numStr(v) { return String(v).replace('.', ','); }
  function todayStr() {
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }
  function fmtDate(d) {
    if (!d) return 'sem data';
    var y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10);
    return day + ' ' + MS[m - 1] + (y !== new Date().getFullYear() ? ' ' + y : '');
  }
  function errMsg(e) { return (e && e.message ? String(e.message) : 'Algo correu mal. Tenta outra vez.').replace(/^Error:\s*/, ''); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function orig(e) { return { d: e.d, c: e.c, s: e.s, v: e.v, p: e.p, h: e.h, x: e.x, n: e.n }; }
  function origT(t) { return { d: t.d, f: t.f, t: t.t, v: t.v, n: t.n }; }
  function same(a, b) { return Calc.same(a, b); }
  function otherOf(n) { return same(n, conf.p1) ? conf.p2 : conf.p1; }
  function payerName(e) { return e.p || conf.joint; }

  var toastTimer;
  function toast(msg, o) {
    o = o || {};
    var t = $('#toast');
    t.textContent = '';
    t.append(h('span', { text: msg }));
    if (o.action) t.append(h('button', { type: 'button', text: o.action.label, onclick: function () { clearTimeout(toastTimer); t.className = ''; o.action.fn(); } }));
    t.className = (o.err ? 'err ' : '') + 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = o.err ? 'err' : ''; }, o.action ? 7000 : (o.err ? 5200 : 3500));
  }

  /* ====================== servidor ====================== */

  function api(fn, args) {
    return fetch(CFG.u, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // sem «preflight» CORS
      body: JSON.stringify({ token: CFG.t, fn: fn, args: args || [] })
    }).then(function (r) { return r.json(); }, function () {
      throw new Error('Sem ligação ao servidor. Tens internet?');
    }).then(function (r) {
      if (r && r.ok) return r.v;
      var e = new Error((r && r.error) || 'Erro do servidor.'); e.code = r && r.code; throw e;
    });
  }
  function call(fn, args, ok, fail) {
    api(fn, args).then(ok, function (e) {
      if (e && e.code === 'AUTH') { showSetup('O código de acesso já não é válido. Pede um link novo.'); return; }
      (fail || handleErr)(e);
    });
  }
  function handleErr(e) {
    toast(errMsg(e), { err: true });
    if (e && e.code === 'CONFLICT') {
      var top = sheetStack[sheetStack.length - 1];
      if (top && (top.kind === 'edit' || top.kind === 'transfer')) closeSheet();
      refresh();
    }
  }

  /* ====================== dados ====================== */

  function applyData(d, fromCache) {
    conf = d.cfg;
    st.exp = Calc.prep(d.exp);
    st.tr = d.tr.slice();
    st.loaded = true; st.legacy = false; st.serverV = d.v || 3; st.loadErr = '';
    if (!fromCache) { st.fetchedAt = Date.now(); lsSet(CACHE, d); }
    hideBanner();
    fillDatalist();
    renderAll();
  }

  function refresh(manual) {
    var btn = $('#refresh');
    btn.classList.add('spin');
    return api('getAll').then(function (d) {
      btn.classList.remove('spin');
      applyData(d);
      if (manual) toast('Atualizado ✓');
    }, function (e) {
      btn.classList.remove('spin');
      if (e && e.code === 'AUTH') { showSetup('O código de acesso já não é válido. Pede um link novo.'); return; }
      if (e && /desconhecido/i.test(e.message || '')) return legacyInit();
      st.loadErr = errMsg(e);
      if (manual || !st.loaded) toast(errMsg(e), { err: true });
      else showBanner('Sem ligação: estás a ver os últimos dados guardados neste telemóvel.');
      renderAll();
    });
  }

  // Servidor antigo (sem getAll): só dá para adicionar despesas até ser atualizado.
  function legacyInit() {
    return api('getInit').then(function (c) {
      conf = c; st.legacy = true; st.loaded = false;
      showBanner('O servidor (Code.gs) ainda é a versão antiga. Podes adicionar despesas, mas o painel, as dívidas e a edição só aparecem depois de o atualizares (ver Definições).');
      renderAll();
    }, function (e) {
      st.loadErr = errMsg(e); toast(errMsg(e), { err: true }); renderAll();
    });
  }

  function showBanner(msg) { var b = $('#banner'); b.textContent = msg; b.hidden = false; }
  function hideBanner() { $('#banner').hidden = true; }

  /* ====================== ligar / desligar ====================== */

  function showSetup(msg) {
    CFG = null; lsDel(STORE); lsDel(CACHE);
    conf = null; st.loaded = false; st.exp = []; st.tr = [];
    $('#app').hidden = true; $('#nav').hidden = true; $('#setup').hidden = false;
    document.body.classList.add('setup-mode');
    $('#sErr').textContent = msg || '';
  }
  function showApp() {
    $('#setup').hidden = true; $('#app').hidden = false; $('#nav').hidden = false;
    document.body.classList.remove('setup-mode');
  }

  $('#sf').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var u = $('#sUrl').value.trim(), t = $('#sTok').value.trim();
    if (!URL_OK.test(u)) { $('#sErr').textContent = 'O endereço tem de começar por https://script.google.com/macros/s/ e acabar em /exec.'; return; }
    if (!t) { $('#sErr').textContent = 'Cola o código de acesso.'; return; }
    var btn = $('#sBtn'); btn.disabled = true; btn.textContent = 'A ligar…';
    CFG = { u: u, t: t };
    api('getAll').then(function (d) {
      lsSet(STORE, CFG); btn.disabled = false; btn.textContent = 'Ligar';
      showApp(); applyData(d); showTab('add');
    }, function (e) {
      if (e && /desconhecido/i.test(e.message || '')) {
        lsSet(STORE, CFG); btn.disabled = false; btn.textContent = 'Ligar'; showApp(); legacyInit().then(function () { showTab('add'); });
        return;
      }
      btn.disabled = false; btn.textContent = 'Ligar'; CFG = null;
      $('#sErr').textContent = e && e.code === 'AUTH' ? 'Código de acesso inválido.' : errMsg(e);
    });
  });

  /* ====================== separadores ====================== */

  function showTab(name) {
    st.tab = name;
    $$('#nav button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    $$('.tab').forEach(function (s) { s.classList.toggle('active', s.id === 'tab-' + name); });
    renderTab(name);
    window.scrollTo(0, 0);
  }
  function renderTab(name) {
    ({ add: renderAdd, dash: renderDash, debt: renderDebt, list: renderList, set: renderSet })[name]();
  }
  function renderAll() {
    renderTab(st.tab);
    var top = sheetStack[sheetStack.length - 1];
    if (top && top.kind === 'list') showSheet(true);
  }
  $$('#nav button').forEach(function (b) { b.addEventListener('click', function () { if (sheetStack.length) closeAllSheets(); showTab(b.dataset.tab); }); });
  $('#refresh').addEventListener('click', function () { refresh(true); });

  function placeholder(text) {
    return h('div', { class: 'card' }, h('p', { class: 'muted', style: 'margin:0', text: text }));
  }
  function guard(root) { // devolve true se ainda não dá para mostrar os dados
    root.textContent = '';
    if (st.legacy) { root.append(placeholder('Esta secção precisa do servidor atualizado. Em Definições está o que fazer (é uma vez só).')); return true; }
    if (!st.loaded) {
      root.append(h('div', { class: 'card' }, h('p', { class: 'muted', style: 'margin:0', text: st.loadErr || 'A carregar…' }),
        st.loadErr ? h('button', { class: 'ghost block', type: 'button', text: 'Tentar outra vez', onclick: function () { refresh(true); } }) : null));
      return true;
    }
    return false;
  }

  /* ====================== gaveta (editar, listas) ====================== */

  var sheetStack = [];
  var lastFocus = null;

  function pushSheet(s) {
    var panel = $('#sheet .panel');
    if (sheetStack.length) sheetStack[sheetStack.length - 1].scroll = panel.scrollTop;
    else lastFocus = document.activeElement;
    sheetStack.push(s);
    try { history.pushState({ sheet: sheetStack.length }, ''); } catch (e) {}
    showSheet();
  }
  function showSheet(keepScroll) {
    var s = sheetStack[sheetStack.length - 1];
    if (!s) return;
    var panel = $('#sheet .panel'), body = $('#sheetBody');
    var y = keepScroll ? panel.scrollTop : (s.scroll || 0);
    $('#sheetTitle').textContent = typeof s.title === 'function' ? s.title() : s.title;
    body.textContent = '';
    s.render(body);
    $('#sheet').hidden = false;
    document.body.classList.add('noscroll');
    panel.scrollTop = y;
    if (!keepScroll) panel.focus({ preventScroll: true });
  }
  // Fecha gavetas até ficarem `depth` abertas (o botão «voltar» do telemóvel também passa por aqui).
  function syncSheets(depth) {
    if (sheetStack.length <= depth) return;
    while (sheetStack.length > depth) sheetStack.pop();
    if (sheetStack.length) showSheet();
    else {
      $('#sheet').hidden = true; document.body.classList.remove('noscroll');
      if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
    }
  }
  function closeSheet() {
    if (!sheetStack.length) return;
    if (history.state && history.state.sheet) history.back(); else syncSheets(sheetStack.length - 1);
  }
  function closeAllSheets() {
    var n = sheetStack.length;
    if (!n) return;
    if (history.state && history.state.sheet) history.go(-n); else syncSheets(0);
  }
  window.addEventListener('popstate', function () { syncSheets((history.state && history.state.sheet) || 0); });
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && sheetStack.length) closeSheet(); });

  /* ====================== controlos de formulário ====================== */

  var uid = 0;

  function segCtl(name, options, selected, onChange) {
    var el = h('div', { class: 'seg' });
    options.forEach(function (o) {
      var i = h('input', { type: 'radio', name: name, value: o, checked: o === selected });
      i.addEventListener('change', function () { if (onChange) onChange(o); });
      el.append(h('label', null, i, h('span', { text: o })));
    });
    return {
      el: el,
      get: function () { var c = el.querySelector('input:checked'); return c ? c.value : ''; },
      set: function (v) { $$('input', el).forEach(function (i) { i.checked = (i.value === v); }); }
    };
  }
  function selectCtl(id, items, first, current) {
    var s = h('select', { id: id });
    s.append(h('option', { value: '', text: first }));
    items.forEach(function (t) { s.append(h('option', { value: t, text: t })); });
    if (current && items.indexOf(current) < 0) s.append(h('option', { value: current, text: current }));
    s.value = current || '';
    return s;
  }

  /** Formulário de despesa, usado para adicionar e para editar. */
  function expenseForm(init, o) {
    var n = ++uid, id = function (k) { return 'f' + n + k; };
    var value = h('input', { id: id('v'), type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', 'aria-label': 'Valor em euros' });
    var desc = h('input', { id: id('d'), type: 'text', autocomplete: 'off', maxLength: 200, placeholder: 'ex.: Fatura da luz, Sofá…', list: 'descList' });
    desc.setAttribute('list', 'descList');
    var cat = selectCtl(id('c'), conf.cats, 'Escolhe a categoria…', init.c);
    var hint = h('p', { class: 'hint' });
    var payer = segCtl('p' + n, [conf.joint, conf.p1, conf.p2], conf.joint, function (v) { setHint(v); });
    var split = segCtl('x' + n, [conf.splitShared, conf.splitP1, conf.splitP2], conf.splitShared);
    var date = h('input', { id: id('t'), type: 'date' });
    var room = selectCtl(id('r'), conf.rooms, '— nenhuma —', init.h);
    var notes = h('input', { id: id('n'), type: 'text', autocomplete: 'off', maxLength: 200 });
    var err = h('div', { class: 'err-inline', role: 'alert' });
    var submit = h('button', { class: 'primary', type: 'submit', text: o.submitLabel });
    var more = h('details', null, h('summary', { text: 'Mais opções' }),
      h('label', { class: 'lbl', htmlFor: id('r') }, 'Divisão da casa ', h('small', { text: '(opcional)' })), room,
      h('label', { class: 'lbl', htmlFor: id('n') }, 'Notas ', h('small', { text: '(opcional)' })), notes);
    var form = h('form', { class: 'card', novalidate: true },
      h('label', { class: 'lbl', htmlFor: id('v') }, 'Valor'),
      h('div', { class: 'amount' }, value, h('span', { text: '€' })),
      h('label', { class: 'lbl', htmlFor: id('d') }, 'Descrição'), desc,
      h('label', { class: 'lbl', htmlFor: id('c') }, 'Categoria'), cat,
      h('div', { class: 'lbl', text: 'Quem pagou' }), payer.el, hint,
      h('div', { class: 'lbl', text: 'Partilha' }), split.el,
      h('label', { class: 'lbl', htmlFor: id('t') }, 'Data'), date,
      more, err, submit);
    form.setAttribute('novalidate', '');

    function setHint(v) {
      hint.textContent = v === conf.joint ? 'Conta conjunta: nada para acertar entre vocês.' : 'Pago do bolso de ' + v + ': o outro deve a sua parte (se for partilhado).';
    }
    function fill(e) {
      value.value = e.v != null ? numStr(e.v) : '';
      desc.value = e.s || '';
      if (e.c && conf.cats.indexOf(e.c) < 0 && !$('option[value="' + e.c.replace(/"/g, '') + '"]', cat)) cat.append(h('option', { value: e.c, text: e.c }));
      cat.value = e.c || '';
      payer.set(e.p || conf.joint); setHint(e.p || conf.joint);
      split.set(e.x || conf.splitShared);
      date.value = e.d || todayStr();
      room.value = e.h || '';
      notes.value = e.n || '';
      if (e.h || e.n) more.open = true;
    }
    fill(init);
    if (!init.d) date.value = todayStr();

    // Ao escrever uma descrição já usada, sugere a categoria/divisão/quem pagou da última vez.
    if (o.suggest) desc.addEventListener('change', function () {
      var q = desc.value.trim().toLowerCase();
      if (!q || cat.value) return;
      var prev = null;
      for (var i = st.exp.length - 1; i >= 0; i--) if (st.exp[i].s.trim().toLowerCase() === q) { prev = st.exp[i]; break; }
      if (!prev) return;
      if (conf.cats.indexOf(prev.c) >= 0) cat.value = prev.c;
      if (prev.h && conf.rooms.indexOf(prev.h) >= 0) { room.value = prev.h; more.open = true; }
      payer.set(prev.p || conf.joint); setHint(prev.p || conf.joint);
      split.set(prev.x || conf.splitShared);
    });

    function fail(msg, el) { err.textContent = msg; if (el) el.focus(); return null; }
    function read() {
      err.textContent = '';
      var v = parseNum(value.value);
      if (!isFinite(v) || v === 0) return fail('Escreve o valor (usa negativo para um reembolso).', value);
      if (!desc.value.trim()) return fail('Escreve uma descrição.', desc);
      if (!cat.value) return fail('Escolhe a categoria.', cat);
      if (!date.value) return fail('Escolhe a data.', date);
      return { date: date.value, value: v, desc: desc.value.trim(), category: cat.value, payer: payer.get(), split: split.get(), room: room.value, notes: notes.value.trim() };
    }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (busy) return;
      var p = read();
      if (p) o.onSubmit(p);
    });
    if (o.extra) form.append(h('div', { class: 'btn-row' }, o.extra));
    return {
      el: form,
      setBusy: function (b) { busy = b; submit.disabled = b; submit.textContent = b ? 'A guardar…' : o.submitLabel; },
      reset: function () { fill({}); more.open = false; value.focus(); },
      fill: fill
    };
  }

  /** Botão que pede confirmação (dois toques) antes de agir. */
  function confirmBtn(label, confirmLabel, fn, cls) {
    var armed = false, timer;
    var b = h('button', { type: 'button', class: cls || 'ghost danger', text: label });
    b.addEventListener('click', function () {
      if (!armed) { armed = true; b.textContent = confirmLabel; timer = setTimeout(function () { armed = false; b.textContent = label; }, 4000); return; }
      clearTimeout(timer); armed = false; b.textContent = label; fn(b);
    });
    return b;
  }

  /* ====================== ADICIONAR ====================== */

  var addForm = null, addSig = '';

  function renderAdd() {
    var root = $('#tab-add');
    if (!conf) {
      addSig = '';
      root.textContent = '';
      root.append(h('div', { class: 'card' }, h('p', { class: 'muted', style: 'margin:0', text: st.loadErr || 'A carregar…' }),
        st.loadErr ? h('button', { class: 'ghost block', type: 'button', text: 'Tentar outra vez', onclick: function () { refresh(true); } }) : null));
      return;
    }
    var sig = JSON.stringify([conf.cats, conf.rooms, conf.joint, conf.p1, conf.p2, conf.splitShared, conf.splitP1, conf.splitP2]);
    if (sig !== addSig) {
      addSig = sig;
      root.textContent = '';
      addForm = expenseForm({}, { submitLabel: 'Guardar despesa', suggest: true, onSubmit: submitNew });
      root.append(addForm.el, h('div', { class: 'card', id: 'recentCard' }));
    }
    renderRecent();
  }

  function renderRecent() {
    var c = $('#recentCard');
    if (!c) return;
    c.textContent = '';
    if (st.legacy || !st.loaded) { c.hidden = true; return; }
    c.hidden = false;
    c.append(h('div', { class: 'card-h' }, h('div', null, h('div', { class: 'card-t', text: 'Últimas despesas' }), h('div', { class: 'card-sub', text: 'Toca numa para corrigir ou apagar.' }))));
    var last = st.exp.slice().sort(function (a, b) { return b.r - a.r; }).slice(0, 5);
    if (!last.length) { c.append(h('div', { class: 'empty', text: 'Ainda não há despesas.' })); return; }
    last.forEach(function (e) { c.append(expRow(e)); });
  }

  function submitNew(p) {
    addForm.setBusy(true);
    call('addExpense', [Object.assign({}, p, { all: true })], function (r) {
      addForm.setBusy(false);
      if (r.data) applyData(r.data);
      addForm.reset();
      var added = r.data ? st.exp.filter(function (e) { return e.r === r.row; })[0] : null;
      toast('Guardado ✓  ' + r.summary, added ? { action: { label: 'Desfazer', fn: function () { undoAdd(added); } } } : null);
    }, function (e) { addForm.setBusy(false); handleErr(e); });
  }
  function undoAdd(e) {
    call('deleteExpense', [e.r, orig(e)], function (r) { applyData(r.data); toast('Anulado'); });
  }

  function fillDatalist() {
    var dl = $('#descList');
    if (!dl) return;
    var seen = {}, out = [];
    st.exp.slice().sort(function (a, b) { return b.r - a.r; }).forEach(function (e) {
      var k = e.s.trim().toLowerCase();
      if (k && !seen[k] && out.length < 150) { seen[k] = 1; out.push(e.s.trim()); }
    });
    dl.textContent = '';
    out.forEach(function (s) { dl.append(h('option', { value: s })); });
  }

  /* ====================== linhas de despesa e edição ====================== */

  function expMeta(e) {
    var parts = [fmtDate(e.d), e.c];
    if (e.h) parts.push(e.h);
    parts.push(payerName(e));
    if (e.x) parts.push(e.x);
    return parts.join(' · ');
  }
  function expRow(e) {
    return h('button', { class: 'xrow', type: 'button', onclick: function () { openEdit(e); }, 'aria-label': e.s + ', ' + money(e.v) + '. Editar' },
      h('span', { class: 'xl' }, h('span', { class: 'xt', text: e.s }), h('span', { class: 'xs', text: expMeta(e) })),
      h('span', { class: 'xv' + (e.v < 0 ? ' neg' : ''), text: money(e.v) }));
  }

  function openEdit(e) {
    pushSheet({
      kind: 'edit', title: 'Editar despesa',
      render: function (body) {
        var f = expenseForm(e, {
          submitLabel: 'Guardar alterações',
          onSubmit: function (p) {
            f.setBusy(true);
            call('updateExpense', [e.r, orig(e), p], function (r) {
              f.setBusy(false); applyData(r.data); closeSheet(); toast('Guardado ✓  ' + r.summary);
            }, function (er) { f.setBusy(false); handleErr(er); });
          },
          extra: [
            h('button', { type: 'button', class: 'ghost', text: 'Duplicar', onclick: function () { duplicate(e); } }),
            confirmBtn('Apagar', 'Toca outra vez para apagar', function () {
              call('deleteExpense', [e.r, orig(e)], function (r) {
                applyData(r.data); closeSheet();
                toast('Despesa apagada', { action: { label: 'Anular', fn: function () { restore(e); } } });
              });
            })
          ]
        });
        body.append(f.el);
      }
    });
  }
  function duplicate(e) {
    closeAllSheets();
    setTimeout(function () {
      showTab('add');
      addForm.fill(Object.assign({}, e, { d: todayStr() }));
      toast('Copiada: ajusta o que mudou e guarda');
    }, 60);
  }
  function restore(e) {
    call('addExpense', [{ date: e.d || todayStr(), value: e.v, desc: e.s, category: e.c, payer: e.p, split: e.x, room: e.h, notes: e.n, all: true }], function (r) {
      applyData(r.data); toast('Despesa reposta ✓');
    });
  }

  /** Lista de despesas numa gaveta (usada em todos os «ver as despesas por trás»). */
  function openList(title, pred) {
    pushSheet({
      kind: 'list', title: title, sort: 'date', limit: 60,
      render: function (body) {
        var s = sheetStack[sheetStack.length - 1];
        var items = st.exp.filter(pred);
        items.sort(s.sort === 'value' ? function (a, b) { return b.v - a.v; } : function (a, b) { return (b.d || '').localeCompare(a.d || '') || b.r - a.r; });
        var total = Calc.sum(items);
        var card = h('div', { class: 'card' },
          h('div', { class: 'card-h' },
            h('div', null, h('div', { class: 'card-t', text: money(total) }), h('div', { class: 'card-sub', text: items.length + (items.length === 1 ? ' despesa' : ' despesas') })),
            h('div', { class: 'btn-row', style: 'margin:0' },
              h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.sort === 'date'), text: 'Data', onclick: function () { s.sort = 'date'; showSheet(true); } }),
              h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.sort === 'value'), text: 'Valor', onclick: function () { s.sort = 'value'; showSheet(true); } }))));
        if (!items.length) card.append(h('div', { class: 'empty', text: 'Sem despesas.' }));
        items.slice(0, s.limit).forEach(function (e) { card.append(expRow(e)); });
        if (items.length > s.limit) card.append(h('button', { type: 'button', class: 'ghost block', text: 'Mostrar mais', onclick: function () { s.limit += 60; showSheet(true); } }));
        body.append(card);
      }
    });
  }

  /* ====================== gráficos ====================== */

  var PLOT = 168;

  function gcolor(i) { return i < 0 ? 'var(--gray)' : 'var(--s' + ((i % 8) + 1) + ')'; }
  function niceScale(max) {
    var raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    var n = Math.ceil(max / step - 1e-9);
    return { step: step, n: n, max: step * n };
  }
  function axisLabel(v) { return v >= 10000 ? nf0.format(v / 1000) + 'k' : nf0.format(v); }

  /**
   * Colunas verticais. kind: 'stack' (empilhadas) ou 'cluster' (lado a lado).
   * buckets: [{ key, label, parts:[{ v, color }] }]
   */
  function colChart(o) {
    var buckets = o.buckets, kind = o.kind;
    var maxV = 1;
    buckets.forEach(function (b) {
      var m = kind === 'stack' ? b.parts.reduce(function (a, p) { return a + Math.max(0, p.v); }, 0) : Math.max.apply(null, [0].concat(b.parts.map(function (p) { return p.v; })));
      if (m > maxV) maxV = m;
    });
    var sc = niceScale(maxV);
    var root = h('div', { class: 'chart' + (o.selected != null ? ' has-sel' : ''), style: 'height:' + (PLOT + 22) + 'px;margin-top:12px' });
    var grid = h('div', { class: 'grid', style: 'height:' + PLOT + 'px' });
    for (var i = 0; i <= sc.n; i++) {
      grid.append(h('div', { class: 'gl' + (i === 0 ? ' base' : ''), style: 'bottom:' + Math.round(i * sc.step / sc.max * PLOT) + 'px' }, h('span', { text: axisLabel(i * sc.step) })));
    }
    var cols = h('div', { class: 'cols' });
    var hpx = function (v) { return Math.max(2, Math.round(v / sc.max * PLOT)); };
    buckets.forEach(function (b) {
      var inner;
      if (kind === 'stack') {
        var pos = b.parts.filter(function (p) { return p.v > 0.005; });
        inner = h('span', { class: 'stk' }, pos.map(function (p, i2) {
          return h('i', { class: i2 === pos.length - 1 ? 'cap' : '', style: 'height:' + hpx(p.v) + 'px;background:' + p.color });
        }));
      } else {
        inner = h('span', { class: 'cluster' }, b.parts.map(function (p) {
          return h('i', { style: 'height:' + (p.v > 0.005 ? hpx(p.v) : 0) + 'px;background:' + p.color });
        }));
      }
      var btn = h('button', {
        class: 'colb', type: 'button', 'aria-pressed': String(b.key === o.selected), 'aria-label': o.aria(b),
        onclick: function () { if (o.onSelect) o.onSelect(b); },
        onpointerenter: function (ev) { if (ev.pointerType === 'mouse' && o.onHover) o.onHover(b); },
        onpointerleave: function (ev) { if (ev.pointerType === 'mouse' && o.onHover) o.onHover(null); },
        onfocus: function () { if (o.onHover) o.onHover(b); },
        onblur: function () { if (o.onHover) o.onHover(null); }
      }, h('span', { class: 'barwrap', style: 'height:' + PLOT + 'px' }, inner), h('span', { class: 'xl-lab', text: b.label }));
      cols.append(btn);
    });
    root.append(grid, cols);
    return root;
  }

  function rankList(items, total) {
    var max = Math.max.apply(null, [1].concat(items.map(function (i) { return Math.abs(i.total); })));
    return items.map(function (i) {
      var share = total > 0 ? pct(i.total / total) : '';
      return h('button', { class: 'rk', type: 'button', onclick: i.onclick, 'aria-label': i.name + ': ' + money(i.total) + (share ? ', ' + share : '') + '. Ver despesas' },
        h('span', { class: 'rk-top' }, h('span', { class: 'rk-name', text: i.name }), h('span', { class: 'rk-val' }, money(i.total), share ? h('small', { text: share }) : null)),
        h('span', { class: 'rk-bar', style: 'width:' + (Math.max(0, i.total) / max * 100) + '%;background:' + i.color }));
    });
  }

  function legendRow(color, name, sub, value, onclick) {
    return h('button', { class: 'legend-row', type: 'button', onclick: onclick, 'aria-label': name + ': ' + value + '. Ver despesas' },
      h('i', { class: 'swatch', style: 'background:' + color }),
      h('span', null, h('span', { class: 'nm', text: name }), h('br'), h('span', { class: 'sb', text: sub })),
      h('span', { class: 'vl', text: value }),
      chevron());
  }
  function chevron() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'chev'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M9 6l6 6-6 6'); s.append(p);
    return s;
  }
  function chip(label, pressed, onclick, swatchColor) {
    return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!!pressed), onclick: onclick },
      swatchColor ? h('i', { class: 'swatch', style: 'background:' + swatchColor }) : null, label);
  }
  function cardHead(title, sub, actions) {
    return h('div', { class: 'card-h' }, h('div', null, h('div', { class: 'card-t', text: title }), sub ? h('div', { class: 'card-sub', text: sub }) : null), actions || null);
  }

  /* ====================== PAINEL ====================== */

  function periodName() {
    var d = st.dash;
    if (d.year === 'all') return 'todo o período';
    return d.month ? MONTHS[d.month - 1] + ' de ' + d.year : String(d.year);
  }

  function renderDash() {
    var root = $('#tab-dash');
    var keepY = window.scrollY;
    if (guard(root)) return;
    var yrs = Calc.years(st.exp);
    if (!yrs.length) { root.append(h('div', { class: 'card empty', text: 'Ainda não há despesas com data para analisar.' })); return; }
    var d = st.dash;
    if (d.year == null || (d.year !== 'all' && yrs.indexOf(d.year) < 0)) {
      var cy = new Date().getFullYear();
      d.year = yrs.indexOf(cy) >= 0 ? cy : yrs[0]; d.month = 0;
    }
    var inP = function (e) { return Calc.inPeriod(e, d.year, d.month); };
    var list = st.exp.filter(inP);
    var yearList = Calc.filterPeriod(st.exp, d.year, 0);
    var total = Calc.sum(list);

    /* --- filtros: uma linha por cima de tudo --- */
    var sel = h('select', { 'aria-label': 'Ano', onchange: function (ev) { d.year = ev.target.value === 'all' ? 'all' : +ev.target.value; d.month = 0; renderDash(); } });
    yrs.forEach(function (y) { sel.append(h('option', { value: y, text: String(y) })); });
    sel.append(h('option', { value: 'all', text: 'Tudo' }));
    sel.value = String(d.year);
    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Mês' });
    if (d.year !== 'all') {
      chips.append(chip('Ano todo', d.month === 0, function () { d.month = 0; renderDash(); }));
      for (var m = 1; m <= 12; m++) (function (mm) {
        chips.append(chip(cap(MS[mm - 1]), d.month === mm, function () { d.month = d.month === mm ? 0 : mm; renderDash(); }));
      })(m);
    }
    root.append(h('div', { class: 'filters' }, h('div', { class: 'filters-in' }, sel, chips)));

    /* --- números principais --- */
    var heroSub = list.length + (list.length === 1 ? ' despesa' : ' despesas');
    if (d.month) {
      var py = d.month === 1 ? d.year - 1 : d.year, pm = d.month === 1 ? 12 : d.month - 1;
      var prev = Calc.sum(st.exp.filter(function (e) { return e.y === py && e.m === pm; }));
      if (Math.abs(prev) > 0.005) {
        var dl = (total - prev) / Math.abs(prev);
        heroSub += ' · ' + (dl >= 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(dl * 100)) + '% face a ' + MONTHS[pm - 1];
      }
    }
    var s = Calc.settle(st.exp, st.tr, conf);
    root.append(h('div', { class: 'kpis' },
      h('button', { class: 'kpi hero', type: 'button', onclick: function () { openList(cap(periodName()), inP); } },
        h('div', { class: 'kpi-l', text: d.year === 'all' ? 'Gasto total' : (d.month ? 'Gasto em ' + periodName() : 'Gasto em ' + d.year) }),
        h('div', { class: 'kpi-v', text: money(total) }),
        h('div', { class: 'kpi-s', text: heroSub }),
        h('div', { class: 'kpi-go', text: 'Ver as despesas ›' })),
      h('div', { class: 'kpi' },
        h('div', { class: 'kpi-l', text: 'Média mensal' }),
        h('div', { class: 'kpi-v', text: money0(Calc.avgPerMonth(yearList)) }),
        h('div', { class: 'kpi-s', text: Calc.monthsWithSpend(yearList) + ' meses com gasto' + (d.year === 'all' ? '' : ' em ' + d.year) })),
      h('button', { class: 'kpi', type: 'button', onclick: function () { showTab('debt'); } },
        h('div', { class: 'kpi-l', text: 'Quem deve a quem' }),
        h('div', { class: 'kpi-v', text: s.quits ? 'Quites' : money(s.value) }),
        h('div', { class: 'kpi-s', text: s.quits ? 'nada para acertar' : s.text }))));

    /* --- quem pagou --- */
    var ps = Calc.payerSplit(list, conf);
    var pcol = ['var(--s5)', 'var(--s6)', 'var(--s7)'];
    var pred = [
      function (e) { return !same(e.p, conf.p1) && !same(e.p, conf.p2); },
      function (e) { return same(e.p, conf.p1); },
      function (e) { return same(e.p, conf.p2); }
    ];
    var thin = h('div', { class: 'thin', role: 'img', 'aria-label': 'Quem pagou: ' + ps.map(function (p) { return p.name + ' ' + money(p.total); }).join(', ') });
    ps.forEach(function (p, i) { if (p.total > 0 && total > 0) thin.append(h('i', { style: 'width:' + (p.total / total * 100) + '%;background:' + pcol[i] })); });
    var payCard = h('div', { class: 'card' }, cardHead('Quem pagou', 'Em ' + periodName()), thin);
    ps.forEach(function (p, i) {
      payCard.append(legendRow(pcol[i], p.name, p.count + (p.count === 1 ? ' despesa' : ' despesas'), money(p.total) + (total > 0 ? ' · ' + pct(p.total / total) : ''),
        function () { openList('Pagas por ' + p.name + ' · ' + periodName(), function (e) { return inP(e) && pred[i](e); }); }));
    });
    root.append(payCard);

    /* --- gasto por mês e por grupo --- */
    var buckets = Calc.series(st.exp, conf, d.year);
    var showRest = buckets.some(function (b) { return Math.abs(b.rest) > 0.005; });
    buckets.forEach(function (b) {
      b.label = d.year === 'all' ? String(b.y) : MS[b.m - 1];
      b.parts = conf.groups.map(function (g, i) { return { name: g, v: b.groups[i], color: gcolor(i) }; });
      if (showRest) b.parts.push({ name: 'Sem grupo', v: b.rest, color: gcolor(-1) });
    });
    var bname = function (b) { return d.year === 'all' ? String(b.y) : cap(MONTHS[b.m - 1]) + ' de ' + b.y; };
    var selKey = d.year === 'all' ? null : (d.month || null);
    var ro = h('div', { class: 'readout', 'aria-live': 'polite' });
    var roShow = function (b) {
      ro.textContent = '';
      if (!b && selKey) b = buckets.filter(function (x) { return x.key === selKey; })[0];
      if (!b) { ro.append(d.year === 'all' ? 'Toca numa coluna para ver só esse ano.' : 'Toca numa coluna para ver só esse mês.'); return; }
      ro.append(h('b', { text: bname(b) }), ' · ' + money(b.total));
      b.parts.filter(function (p) { return Math.abs(p.v) >= 0.005; }).forEach(function (p) {
        ro.append(' ', h('span', { class: 'ro-g' }, h('i', { class: 'swatch', style: 'background:' + p.color }), p.name + ' ' + money0(p.v)));
      });
      if (b.parts.some(function (p) { return p.v < -0.005; })) ro.append(h('div', { class: 'hint', text: 'Há reembolsos neste período: o total já os desconta, a coluna mostra só os gastos.' }));
    };
    var chartHost = h('div');
    var drawA = function () {
      chartHost.textContent = '';
      if (d.tableA) {
        var head = ['Mês'].concat(buckets[0].parts.map(function (p) { return p.name; }), ['Total']);
        if (d.year === 'all') head[0] = 'Ano';
        chartHost.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, head.map(function (t) { return h('th', { scope: 'col', text: t }); }))),
          h('tbody', null, buckets.filter(function (b) { return b.count > 0; }).map(function (b) {
            return h('tr', null, h('td', { text: d.year === 'all' ? String(b.y) : cap(MONTHS[b.m - 1]) }), b.parts.map(function (p) { return h('td', { text: money0(p.v) }); }), h('td', { class: 'k', text: money0(b.total) }));
          })),
          h('tfoot', null, h('tr', null, h('td', { text: 'Total' }), buckets[0].parts.map(function (p, i) {
            return h('td', { text: money0(buckets.reduce(function (a, b) { return a + b.parts[i].v; }, 0)) });
          }), h('td', { text: money0(buckets.reduce(function (a, b) { return a + b.total; }, 0)) }))))));
      } else {
        chartHost.append(colChart({
          kind: 'stack', buckets: buckets, selected: selKey,
          aria: function (b) { return bname(b) + ': ' + money(b.total) + '. ' + (d.year === 'all' ? 'Tocar para ver só este ano' : 'Tocar para ver só este mês'); },
          onSelect: function (b) { if (d.year === 'all') { d.year = b.y; d.month = 0; } else d.month = d.month === b.m ? 0 : b.m; renderDash(); },
          onHover: roShow
        }), ro);
        roShow(null);
      }
    };
    var tblBtnA = h('button', { type: 'button', class: 'ghost sm', text: d.tableA ? 'Gráfico' : 'Tabela', onclick: function () { d.tableA = !d.tableA; tblBtnA.textContent = d.tableA ? 'Gráfico' : 'Tabela'; drawA(); } });
    var cardA = h('div', { class: 'card' }, cardHead(d.year === 'all' ? 'Gasto por ano' : 'Gasto por mês em ' + d.year, 'Por grupo de categorias', tblBtnA), chartHost);
    drawA();
    // legenda = resumo por grupo (período escolhido)
    var gl = Calc.byGroup(list, conf).filter(function (g) { return g.count > 0; });
    var gHead = h('div', { class: 'lbl', style: 'margin-top:16px', text: 'Resumo por grupo · ' + periodName() });
    cardA.append(gHead);
    gl.forEach(function (g) {
      var gl2 = g.other ? function (e) { return conf.groups.indexOf(Calc.groupOf(conf, e.c)) < 0; } : function (e) { return Calc.groupOf(conf, e.c) === g.name; };
      var avg = d.month ? '' : ' · média ' + money0(Calc.avgPerMonth(list.filter(gl2))) + '/mês';
      cardA.append(legendRow(gcolor(g.idx), g.name, (total > 0 ? pct(g.total / total) : '0%') + (d.month ? ' do total' : '') + avg, money(g.total),
        function () { openList(g.name + ' · ' + periodName(), function (e) { return inP(e) && gl2(e); }); }));
    });
    root.append(cardA);

    /* --- categorias --- */
    var cats = Calc.byCategory(list, conf).sort(function (a, b) { return b.total - a.total; });
    var catCard = h('div', { class: 'card' }, cardHead('Categorias', 'Em ' + periodName() + ' · cor = grupo'));
    if (!cats.length) catCard.append(h('div', { class: 'empty', text: 'Sem despesas neste período.' }));
    var shown = d.allCats ? cats : cats.slice(0, 8);
    rankList(shown.map(function (c) {
      return {
        name: c.name, total: c.total, color: gcolor(c.other ? -1 : conf.groups.indexOf(c.group)),
        onclick: function () { openList(c.name + ' · ' + periodName(), function (e) { return inP(e) && (c.other ? conf.cats.indexOf(e.c) < 0 : e.c === c.name); }); }
      };
    }), total).forEach(function (r) { catCard.append(r); });
    if (cats.length > 8) catCard.append(h('button', { type: 'button', class: 'ghost block', text: d.allCats ? 'Mostrar só as 8 maiores' : 'Ver todas (' + cats.length + ')', onclick: function () { d.allCats = !d.allCats; renderDash(); } }));
    root.append(catCard);

    /* --- divisões da casa --- */
    var rooms = Calc.byRoom(list, conf).sort(function (a, b) { return b.total - a.total; });
    if (rooms.length) {
      var roomCard = h('div', { class: 'card' }, cardHead('Divisões da casa', 'Em ' + periodName()));
      rankList(rooms.map(function (r) {
        return {
          name: r.name, total: r.total, color: r.other ? 'var(--gray)' : 'var(--s1)',
          onclick: function () { openList(r.name + ' · ' + periodName(), function (e) { return inP(e) && (r.other ? conf.rooms.indexOf(e.h) < 0 : e.h === r.key); }); }
        };
      }), total).forEach(function (r) { roomCard.append(r); });
      root.append(roomCard);
    }

    /* --- evolução de categorias (luz, água, gás…) --- */
    var evoYear = d.year === 'all' ? yrs[0] : d.year;
    if (!d.evo) d.evo = conf.cats.slice(0, 3);
    d.evo = d.evo.filter(function (c) { return conf.cats.indexOf(c) >= 0; });
    var used = {};
    d.evo.forEach(function (c) { if (d.slots[c]) used[d.slots[c]] = 1; });
    d.evo.forEach(function (c) { if (!d.slots[c]) for (var k = 1; k <= 4; k++) if (!used[k]) { d.slots[c] = k; used[k] = 1; break; } });
    var evoCol = function (c) { return 'var(--s' + d.slots[c] + ')'; };
    var evoBuckets = [];
    for (var mi = 1; mi <= 12; mi++) evoBuckets.push({ key: mi, m: mi, label: MS[mi - 1], parts: [] });
    d.evo.forEach(function (c) {
      var ser = Calc.catSeries(st.exp, c, evoYear);
      evoBuckets.forEach(function (b, i) { b.parts.push({ name: c, v: ser[i], color: evoCol(c) }); });
    });
    var evoHost = h('div');
    var evoRo = h('div', { class: 'readout', 'aria-live': 'polite' });
    var evoShow = function (b) {
      evoRo.textContent = '';
      if (!b && d.year !== 'all' && d.month) b = evoBuckets[d.month - 1];
      if (!b) { evoRo.append('Toca numa coluna para ver os valores desse mês.'); return; }
      evoRo.append(h('b', { text: cap(MONTHS[b.m - 1]) + ' de ' + evoYear }));
      b.parts.forEach(function (p) { evoRo.append(' ', h('span', { class: 'ro-g' }, h('i', { class: 'swatch', style: 'background:' + p.color }), p.name + ' ' + money(p.v))); });
    };
    var evoPick = null;
    var drawE = function () {
      evoHost.textContent = '';
      if (!d.evo.length) { evoHost.append(h('div', { class: 'empty', text: 'Escolhe uma categoria para ver a evolução.' })); return; }
      if (d.tableE) {
        evoHost.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, [h('th', { scope: 'col', text: 'Mês' })].concat(d.evo.map(function (c) { return h('th', { scope: 'col', text: c }); })))),
          h('tbody', null, evoBuckets.map(function (b) { return h('tr', null, h('td', { text: cap(MONTHS[b.m - 1]) }), b.parts.map(function (p) { return h('td', { text: money(p.v) }); })); })),
          h('tfoot', null, h('tr', null, h('td', { text: 'Total' }), d.evo.map(function (c, i) { return h('td', { text: money(evoBuckets.reduce(function (a, b) { return a + b.parts[i].v; }, 0)) }); }))))));
      } else {
        evoHost.append(colChart({
          kind: 'cluster', buckets: evoBuckets, selected: d.year !== 'all' && d.month ? d.month : null,
          aria: function (b) { return cap(MONTHS[b.m - 1]) + ': ' + b.parts.map(function (p) { return p.name + ' ' + money(p.v); }).join(', '); },
          onSelect: function (b) { evoShow(b); },
          onHover: evoShow
        }), evoRo);
        evoShow(null);
      }
    };
    var tblBtnE = h('button', { type: 'button', class: 'ghost sm', text: d.tableE ? 'Gráfico' : 'Tabela', onclick: function () { d.tableE = !d.tableE; tblBtnE.textContent = d.tableE ? 'Gráfico' : 'Tabela'; drawE(); } });
    var evoChips = h('div', { class: 'chips', style: 'flex-wrap:wrap;overflow:visible;margin-top:8px' });
    d.evo.forEach(function (c) {
      evoChips.append(chip(c + '  ✕', true, function () { d.evo = d.evo.filter(function (x) { return x !== c; }); delete d.slots[c]; renderDash(); }, null));
      evoChips.lastChild.insertBefore(h('i', { class: 'swatch', style: 'background:' + evoCol(c) }), evoChips.lastChild.firstChild);
    });
    if (d.evo.length < 4) {
      evoPick = h('select', { 'aria-label': 'Juntar categoria', style: 'width:auto;min-height:40px;padding-top:6px;padding-bottom:6px', onchange: function (ev) { if (ev.target.value) { d.evo.push(ev.target.value); renderDash(); } } });
      evoPick.append(h('option', { value: '', text: '＋ Juntar categoria' }));
      conf.cats.filter(function (c) { return d.evo.indexOf(c) < 0; }).forEach(function (c) { evoPick.append(h('option', { value: c, text: c })); });
      evoChips.append(evoPick);
    }
    root.append(h('div', { class: 'card' }, cardHead('Evolução por categoria', 'Mês a mês em ' + evoYear + ' (até 4 categorias)', tblBtnE), evoChips, evoHost));
    drawE();

    /* --- maiores despesas --- */
    var big = list.slice().sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
    if (big.length) {
      var bigCard = h('div', { class: 'card' }, cardHead('Maiores despesas', 'Em ' + periodName()));
      big.forEach(function (e) { bigCard.append(expRow(e)); });
      root.append(bigCard);
    }

    // posição certa nos filtros e no scroll
    var sc = $('.chips', root), on = sc && $('[aria-pressed="true"]', sc);
    if (on) sc.scrollLeft = on.offsetLeft - sc.clientWidth / 2 + on.offsetWidth / 2;
    window.scrollTo(0, keepY);
  }

  /* ====================== DÍVIDAS ====================== */

  function renderDebt() {
    var root = $('#tab-debt');
    var keepY = window.scrollY;
    if (guard(root)) return;
    var s = Calc.settle(st.exp, st.tr, conf);
    var hero = h('div', { class: 'card debt-hero' },
      h('div', { class: 'muted', text: 'Acerto de contas' }),
      h('div', { class: 'who', text: s.text }),
      s.quits ? h('div', { class: 'muted', style: 'margin:8px 0', text: 'Não há nada para acertar.' }) : h('div', { class: 'amt', text: money(s.value) }),
      h('button', { type: 'button', class: s.quits ? 'ghost block' : 'primary', text: 'Registar transferência',
        onclick: function () { openTransfer(s.quits ? { from: conf.p2, value: '' } : { from: s.from, value: s.value }); } }),
      h('div', { class: 'muted small', style: 'margin-top:10px', text: 'As despesas pagas pela conta conjunta não criam dívida entre vocês.' }));
    root.append(hero);

    /* --- como se chega a este valor --- */
    var R = s.rows;
    var line = function (label, arr, o) {
      o = o || {};
      return h('tr', { class: o.bold ? 'b' : '' }, h('td', { text: label }), h('td', { text: (o.sign || '') + money(arr[0]) }), h('td', { text: (o.sign || '') + money(arr[1]) }));
    };
    root.append(h('div', { class: 'card' },
      cardHead('Como se chega a este valor', 'Tudo desde o início, já com as transferências'),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl fit' },
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: '' }), h('th', { scope: 'col', text: conf.p1 }), h('th', { scope: 'col', text: conf.p2 }))),
        h('tbody', null,
          line('Pagou do bolso', R.direct),
          line('Pôs na conta conjunta', R.jointShare),
          line('Total que pagou', R.paid, { bold: true }),
          line('Despesas só dele/dela', R.only),
          line('A sua parte de tudo', R.part),
          line('Diferença (pagou − parte)', R.diff, { bold: true }),
          line('Transferências recebidas', R.recv, { sign: '− ' }),
          line('Transferências enviadas', R.sent, { sign: '+ ' }),
          line('Saldo (+ = tem a receber)', R.net, { bold: true })))),
      h('p', { class: 'hint', text: 'Despesas partilhadas pelos dois: ' + money(s.shared) + ' · a quota de ' + conf.p1 + ' é ' + pct(conf.pct1) + ' e a conta conjunta é financiada ' + pct(conf.fund1) + ' por ' + conf.p1 + ' (Config no Excel).' })));

    /* --- ver as despesas por trás --- */
    var rows = [
      ['Pagas do bolso de ' + conf.p1, function (e) { return same(e.p, conf.p1); }],
      ['Pagas do bolso de ' + conf.p2, function (e) { return same(e.p, conf.p2); }],
      ['Pagas pela ' + conf.joint.toLowerCase(), function (e) { return !same(e.p, conf.p1) && !same(e.p, conf.p2); }],
      ['Só de ' + conf.p1, function (e) { return same(e.x, conf.splitP1); }],
      ['Só de ' + conf.p2, function (e) { return same(e.x, conf.splitP2); }]
    ];
    var back = h('div', { class: 'card' }, cardHead('As despesas por trás', 'Toca para ver a lista'));
    rows.forEach(function (r) {
      var l = st.exp.filter(r[1]);
      back.append(h('button', { class: 'mrow', type: 'button', onclick: function () { openList(r[0], r[1]); }, 'aria-label': r[0] + ': ' + money(Calc.sum(l)) },
        h('span', null, h('b', { text: r[0] }), h('br'), h('span', { class: 'muted small', text: l.length + (l.length === 1 ? ' despesa' : ' despesas') })),
        h('span', { style: 'font-weight:700', text: money(Calc.sum(l)) })));
    });
    root.append(back);

    /* --- transferências --- */
    var trCard = h('div', { class: 'card' }, cardHead('Transferências entre vocês', 'Já feitas para acertar contas',
      h('button', { type: 'button', class: 'ghost sm', text: 'Registar', onclick: function () { openTransfer({ from: s.from || conf.p2, value: s.value || '' }); } })));
    var trs = st.tr.slice().sort(function (a, b) { return (b.d || '').localeCompare(a.d || '') || b.r - a.r; });
    if (!trs.length) trCard.append(h('div', { class: 'empty', text: 'Ainda sem transferências.' }));
    trs.forEach(function (t) {
      trCard.append(h('button', { class: 'xrow', type: 'button', onclick: function () { openTransfer(t, true); }, 'aria-label': t.f + ' para ' + t.t + ', ' + money(t.v) + '. Editar' },
        h('span', { class: 'xl' }, h('span', { class: 'xt', text: t.f + ' → ' + t.t }), h('span', { class: 'xs', text: fmtDate(t.d) + (t.n ? ' · ' + t.n : '') })),
        h('span', { class: 'xv', text: money(t.v) })));
    });
    root.append(trCard);

    /* --- mês a mês --- */
    var yrs = Calc.years(st.exp);
    if (yrs.length) {
      var yd = st.debt;
      if (yd.year == null || yrs.indexOf(yd.year) < 0) yd.year = yrs.indexOf(st.dash.year) >= 0 ? st.dash.year : yrs[0];
      var ysel = h('select', { 'aria-label': 'Ano', style: 'width:auto;min-height:40px;padding-top:6px;padding-bottom:6px', onchange: function (ev) { yd.year = +ev.target.value; renderDebt(); } });
      yrs.forEach(function (y) { ysel.append(h('option', { value: y, text: String(y) })); });
      ysel.value = String(yd.year);
      var mm = h('div', { class: 'card' }, cardHead('Mês a mês', 'Saldo de cada mês, sem contar transferências', ysel));
      var any = false;
      for (var m = 1; m <= 12; m++) {
        var sm = Calc.settleMonth(st.exp, conf, yd.year, m);
        if (!sm.count) continue;
        any = true;
        (function (mo, smo) {
          var pill = Math.abs(smo.net1) < 0.005 ? 'quites' : (smo.net1 > 0 ? conf.p2 + ' deve ' + money(smo.net1) : conf.p1 + ' deve ' + money(-smo.net1));
          mm.append(h('button', { class: 'mrow', type: 'button', onclick: function () { openList(cap(MONTHS[mo - 1]) + ' de ' + yd.year, function (e) { return e.y === yd.year && e.m === mo; }); } },
            h('span', null, h('b', { text: cap(MONTHS[mo - 1]) }), h('br'), h('span', { class: 'muted small', text: money(smo.total) + ' gastos · ' + smo.count + (smo.count === 1 ? ' despesa' : ' despesas') })),
            h('span', { class: 'pill', text: pill })));
        })(m, sm);
      }
      if (!any) mm.append(h('div', { class: 'empty', text: 'Sem despesas neste ano.' }));
      root.append(mm);
    }
    window.scrollTo(0, keepY);
  }

  /** Formulário de transferência (registar ou editar). */
  function openTransfer(init, existing) {
    pushSheet({
      kind: 'transfer', title: existing ? 'Editar transferência' : 'Registar transferência',
      render: function (body) {
        var n = ++uid;
        var people = [conf.p1, conf.p2];
        // uma transferência guardada usa f/t/v/n; o pedido novo usa from/value
        var T = existing ? { from: init.f, value: init.v, d: init.d, n: init.n } : init;
        var to = h('div', { class: 'hint' });
        var from = segCtl('tf' + n, people, T.from || conf.p2, function () { upd(); });
        var upd = function () { to.textContent = 'Para: ' + otherOf(from.get()); };
        upd();
        var value = h('input', { id: 'tv' + n, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', 'aria-label': 'Valor em euros' });
        value.value = T.value === '' || T.value == null ? '' : numStr(T.value);
        var date = h('input', { id: 'td' + n, type: 'date' });
        date.value = T.d || todayStr();
        var note = h('input', { id: 'tn' + n, type: 'text', autocomplete: 'off', maxLength: 200 });
        note.value = existing ? (T.n || '') : 'Acerto de contas';
        var err = h('div', { class: 'err-inline', role: 'alert' });
        var submit = h('button', { class: 'primary', type: 'submit', text: existing ? 'Guardar alterações' : 'Registar transferência' });
        var f = h('form', { class: 'card', novalidate: true },
          h('div', { class: 'lbl', text: 'Quem enviou' }), from.el, to,
          h('label', { class: 'lbl', htmlFor: 'tv' + n, text: 'Valor' }), h('div', { class: 'amount' }, value, h('span', { text: '€' })),
          h('label', { class: 'lbl', htmlFor: 'td' + n, text: 'Data' }), date,
          h('label', { class: 'lbl', htmlFor: 'tn' + n }, 'Nota ', h('small', { text: '(opcional)' })), note,
          err, submit);
        f.setAttribute('novalidate', '');
        f.addEventListener('submit', function (ev) {
          ev.preventDefault();
          if (busy) return;
          var v = parseNum(value.value);
          if (!isFinite(v) || v <= 0) { err.textContent = 'Escreve um valor maior que zero.'; value.focus(); return; }
          if (!date.value) { err.textContent = 'Escolhe a data.'; return; }
          var fr = from.get(), p = { date: date.value, from: fr, to: otherOf(fr), value: v, note: note.value };
          busy = true; submit.disabled = true;
          var done = function (r) {
            busy = false; submit.disabled = false;
            if (r.data) applyData(r.data); else { refresh(); }
            closeSheet(); toast('Registado ✓  ' + r.summary);
          };
          var bad = function (e) { busy = false; submit.disabled = false; handleErr(e); };
          if (existing) call('updateTransfer', [init.r, origT(init), p], done, bad);
          else call('addTransfer', [Object.assign({ all: true }, p)], done, bad);
        });
        if (existing) f.append(h('div', { class: 'btn-row' }, confirmBtn('Apagar', 'Toca outra vez para apagar', function () {
          call('deleteTransfer', [init.r, origT(init)], function (r) { applyData(r.data); closeSheet(); toast('Transferência apagada'); });
        })));
        body.append(f);
      }
    });
  }

  /* ====================== DESPESAS (lista, procurar, editar) ====================== */

  var listSig = '';

  function listFiltered() {
    var f = st.list, q = f.q.trim().toLowerCase();
    return st.exp.filter(function (e) {
      if (f.year !== 'all' && e.y !== f.year) return false;
      if (f.month && e.m !== f.month) return false;
      if (f.cat && e.c !== f.cat) return false;
      if (f.payer === 'joint' && (same(e.p, conf.p1) || same(e.p, conf.p2))) return false;
      if (f.payer === 'p1' && !same(e.p, conf.p1)) return false;
      if (f.payer === 'p2' && !same(e.p, conf.p2)) return false;
      if (q) {
        var hay = [e.s, e.c, e.h, e.n, payerName(e), e.x, numStr(e.v), e.d].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return (b.d || '').localeCompare(a.d || '') || b.r - a.r; });
  }

  function renderList() {
    var root = $('#tab-list');
    if (st.legacy || !st.loaded) { listSig = ''; guard(root); return; }
    var yrs = Calc.years(st.exp);
    var sig = JSON.stringify([yrs, conf.cats, conf.p1, conf.p2, conf.joint]);
    if (sig !== listSig) {
      listSig = sig;
      root.textContent = '';
      var f = st.list;
      var q = h('input', { type: 'search', placeholder: 'Procurar descrição ou valor…', 'aria-label': 'Procurar', autocomplete: 'off', value: f.q });
      q.addEventListener('input', function () { f.q = q.value; f.limit = 40; renderListResults(); });
      var mk = function (label, opts, cur, fn) {
        var s = h('select', { 'aria-label': label });
        opts.forEach(function (o) { s.append(h('option', { value: o[0], text: o[1] })); });
        s.value = String(cur);
        s.addEventListener('change', function () { fn(s.value); f.limit = 40; renderListResults(); });
        return s;
      };
      var selYear = mk('Ano', [['all', 'Todos os anos']].concat(yrs.map(function (y) { return [String(y), String(y)]; })), f.year, function (v) { f.year = v === 'all' ? 'all' : +v; });
      var selMonth = mk('Mês', [['0', 'Ano todo']].concat(MONTHS.map(function (m, i) { return [String(i + 1), cap(m)]; })), f.month, function (v) { f.month = +v; });
      var selCat = mk('Categoria', [['', 'Todas as categorias']].concat(conf.cats.map(function (c) { return [c, c]; })), f.cat, function (v) { f.cat = v; });
      var selPay = mk('Quem pagou', [['', 'Quem pagou: todos'], ['joint', conf.joint], ['p1', conf.p1], ['p2', conf.p2]], f.payer, function (v) { f.payer = v; });
      selCat.style.gridColumn = '1 / -1'; selPay.style.gridColumn = '1 / -1';
      root.append(h('div', { class: 'card' }, q,
        h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px' }, selYear, selMonth, selCat, selPay)),
        h('div', { id: 'listRes' }));
    }
    renderListResults();
  }

  function renderListResults() {
    var host = $('#listRes');
    if (!host) return;
    var f = st.list, items = listFiltered();
    host.textContent = '';
    var card = h('div', { class: 'card' }, h('div', { class: 'card-h' },
      h('div', null, h('div', { class: 'card-t', text: money(Calc.sum(items)) }), h('div', { class: 'card-sub', text: items.length + (items.length === 1 ? ' despesa' : ' despesas') }))));
    if (!items.length) card.append(h('div', { class: 'empty', text: 'Nenhuma despesa encontrada.' }));
    items.slice(0, f.limit).forEach(function (e) { card.append(expRow(e)); });
    if (items.length > f.limit) card.append(h('button', { type: 'button', class: 'ghost block', text: 'Mostrar mais', onclick: function () { f.limit += 40; renderListResults(); } }));
    host.append(card);
  }

  /* ====================== DEFINIÇÕES ====================== */

  function renderSet() {
    var root = $('#tab-set');
    root.textContent = '';
    var shareErr = h('div', { class: 'err-inline' });
    root.append(h('div', { class: 'card stack' },
      h('div', null, h('strong', { text: 'Este telemóvel está ligado ✓' })),
      h('div', { class: 'muted', text: 'Para ligar outro telemóvel, envia-lhe o link de acesso. O link contém o código, por isso envia-o só em privado.' }),
      h('button', { type: 'button', class: 'primary', style: 'margin-top:0', text: 'Partilhar acesso', onclick: function () { share(shareErr); } }),
      shareErr,
      h('button', { type: 'button', class: 'ghost block', text: 'Atualizar dados agora', onclick: function () { refresh(true); } })));

    /* aspeto */
    var themeCtl = segCtl('theme', ['Automático', 'Claro', 'Escuro'], { auto: 'Automático', light: 'Claro', dark: 'Escuro' }[ui.theme], function (v) {
      ui.theme = { 'Automático': 'auto', 'Claro': 'light', 'Escuro': 'dark' }[v]; lsSet(UIKEY, ui); applyUi(); renderAll();
    });
    var sw = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Cor de destaque' });
    ACCENTS.forEach(function (a) {
      sw.append(h('button', { type: 'button', class: 'sw', style: 'background:' + a.l, 'aria-label': a.n, 'aria-pressed': String(ui.accent === a.id), title: a.n,
        onclick: function () { ui.accent = a.id; lsSet(UIKEY, ui); applyUi(); renderSet(); } }));
    });
    var file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', function () { if (file.files && file.files[0]) pickPhoto(file.files[0]); });
    root.append(h('div', { class: 'card stack' },
      cardHead('Aspeto', 'Só muda neste telemóvel'),
      h('div', { class: 'lbl', style: 'margin-top:0', text: 'Tema' }), themeCtl.el,
      h('div', { class: 'lbl', text: 'Cor de destaque' }), sw,
      h('div', { class: 'lbl', text: 'Foto de fundo' }),
      h('div', { class: 'btn-row', style: 'margin-top:0' },
        h('button', { type: 'button', class: 'ghost', text: 'Escolher foto…', onclick: function () { file.click(); } }),
        lsGet(BGKEY) ? h('button', { type: 'button', class: 'ghost', text: 'Tirar foto', onclick: function () { lsDel(BGKEY); applyBg(); renderSet(); } }) : null),
      file));

    /* servidor */
    var srv = h('div', { class: 'card stack' }, cardHead('Servidor', st.legacy ? 'Versão antiga' : 'Versão ' + (st.serverV || '—')));
    if (st.legacy) {
      srv.append(h('div', { class: 'muted', text: 'Para ter o painel, as dívidas e a edição: abre o Apps Script da folha, substitui o conteúdo de Código.gs pelo ficheiro novo, e em Implementar › Gerir implementações escolhe o lápis, «Nova versão» e Implementar. O endereço e o código mantêm-se e nenhum telemóvel precisa de ser ligado outra vez.' }));
    } else {
      srv.append(h('div', { class: 'muted', text: 'Tudo certo: a app lê e escreve diretamente na folha de cálculo.' }));
    }
    srv.append(confirmBtn('Desligar este telemóvel', 'Toca outra vez para confirmar', function () { showSetup('Telemóvel desligado.'); }, 'ghost block'));
    root.append(srv);
  }

  function share(errEl) {
    if (!CFG) return;
    var link = location.origin + location.pathname + '#u=' + encodeURIComponent(CFG.u) + '&t=' + encodeURIComponent(CFG.t);
    var text = 'Abre este link no telemóvel para ligar a app das despesas da casa:';
    if (navigator.share) navigator.share({ title: 'Despesas da casa', text: text, url: link }).catch(function () {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { toast('Link copiado ✓'); }, function () { errEl.textContent = link; });
    else errEl.textContent = link;
  }

  /* ====================== aspeto: tema, cor, foto ====================== */

  function isDark() {
    return ui.theme === 'dark' || (ui.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function applyUi() {
    var root = document.documentElement;
    if (ui.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', ui.theme);
    var a = ACCENTS.filter(function (x) { return x.id === ui.accent; })[0] || ACCENTS[0], dark = isDark();
    root.style.setProperty('--accent', dark ? a.d : a.l);
    root.style.setProperty('--accent-ink', dark ? '#0f1522' : '#ffffff');
    var meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#12151c' : a.l);
  }
  function applyBg() {
    var data = lsGet(BGKEY);
    var set = function (url) {
      document.documentElement.style.setProperty('--bgimg', 'url("' + url + '")');
      document.body.classList.add('hasbg');
    };
    if (typeof data === 'string' && data.indexOf('data:image/') === 0) { set(data); return; }
    document.body.classList.remove('hasbg');
    var im = new Image(); // ficheiro fundo.jpg no GitHub (opcional)
    im.onload = function () { if (!lsGet(BGKEY)) set('fundo.jpg'); };
    im.src = 'fundo.jpg';
  }
  function pickPhoto(file) {
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      var max = 1100, k = Math.min(1, max / Math.max(im.width, im.height));
      var cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      var ok = lsSet(BGKEY, cv.toDataURL('image/jpeg', 0.62));
      if (!ok) toast('A foto é demasiado grande para guardar. Tenta outra.', { err: true });
      applyBg(); renderSet();
    };
    im.onerror = function () { URL.revokeObjectURL(url); toast('Não consegui abrir essa imagem.', { err: true }); };
    im.src = url;
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function () { if (ui.theme === 'auto') applyUi(); });
  }

  /* ====================== arranque ====================== */

  var saved0 = lsGet(UIKEY);
  if (saved0 && typeof saved0 === 'object') ui = Object.assign(ui, saved0);
  applyUi();
  applyBg();

  // Link de acesso: …/#u=<servidor>&t=<código>. Guarda e limpa o endereço.
  var hash = location.hash.replace(/^#/, '');
  if (hash) {
    var p = new URLSearchParams(hash), lu = p.get('u'), lt = p.get('t');
    if (lu && lt) {
      history.replaceState(null, '', location.pathname + location.search);
      if (URL_OK.test(lu)) { lsSet(STORE, { u: lu, t: lt }); lsDel(CACHE); }
    }
  }

  var saved = lsGet(STORE);
  if (saved && saved.u && saved.t && URL_OK.test(saved.u)) {
    CFG = saved;
    showApp();
    var cached = lsGet(CACHE);
    if (cached && cached.cfg && cached.exp) applyData(cached, true); // abre já com os últimos números
    else renderAll();
    refresh();
  } else {
    showSetup('');
  }

  // Ao voltar à app, atualiza se os dados já têm algum tempo.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && CFG && !busy && !sheetStack.length && Date.now() - st.fetchedAt > 45000) refresh();
  });

  if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); }); }
})();
