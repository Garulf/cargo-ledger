var DOTS = ['#a6e3a1','#89b4fa','#cba6f7','#fab387','#94e2d5','#f5c2e7','#f9e2af','#74c7ec'];

  var settings = Store.loadSettings();

  var state = {
    phase: 'idle',
    fLoc: '', fCom: '', fAmt: '', fBuy: '',
    active: null,
    eLoc: '', eSold: '', eSell: '',
    hovered: -1,
    runs: Store.loadRuns(),
    commodities: [],   // from UEX
    terminals: [],     // from UEX
    buyableIds: null,  // null = no filter; else set of String commodity ids sold at fLoc
    sellableIds: null, // null = no filter; else set of String terminal ids that take active commodity
  };

  var toastTimeout = null;
  var pricePromises = {};

  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function abbr(n) { var a = Math.abs(n); var s = n < 0 ? '-' : ''; if (a >= 1e6) return s + (a/1e6).toFixed(2) + 'M'; if (a >= 1e3) return s + Math.round(a/1e3) + 'K'; return s + Math.round(a); }
  function clock(sec) { sec = Math.max(0, Math.floor(sec)); var h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60; var p = function(x){ return String(x).padStart(2,'0'); }; return h > 0 ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function $(id) { return document.getElementById(id); }

  // ----- data helpers -----
  function terminalById(id) {
    for (var i=0;i<state.terminals.length;i++){ if (String(state.terminals[i].id) === String(id)) return state.terminals[i]; }
    return null;
  }
  function commodityById(id) {
    for (var i=0;i<state.commodities.length;i++){ if (String(state.commodities[i].id) === String(id)) return state.commodities[i]; }
    return null;
  }
  function getPricesFor(terminalId) {
    if (!pricePromises[terminalId]) {
      pricePromises[terminalId] = UEX.getPrices(terminalId).catch(function(err){
        delete pricePromises[terminalId];
        throw err;
      });
    }
    return pricePromises[terminalId];
  }

  function buildChart(runs) {
    var cum = [0]; var t = 0;
    runs.forEach(function(r){ t += r.profit; cum.push(t); });
    var n = cum.length;
    var x0=44, x1=798, y0=28, y1=262;
    var hi = Math.max.apply(null, cum), lo = Math.min.apply(null, cum);
    var top = Math.max(1, hi) * 1.12;
    var bot = lo < 0 ? lo * 1.12 : 0;
    var X = function(i){ return n <= 1 ? x0 : x0 + (i/(n-1))*(x1-x0); };
    var Y = function(v){ return y1 - ((v - bot)/(top - bot))*(y1-y0); };
    var line = '';
    for (var i=0;i<n;i++) line += (i===0?'M':'L') + X(i).toFixed(1) + ' ' + Y(cum[i]).toFixed(1) + ' ';
    var area = line + 'L ' + X(n-1).toFixed(1) + ' ' + y1 + ' L ' + X(0).toFixed(1) + ' ' + y1 + ' Z';
    var points = [];
    for (var j=1;j<n;j++) {
      var r = runs[j-1];
      points.push({
        idx: j, cx: X(j), cy: Y(cum[j]),
        r: state.hovered === j ? 6 : 4,
        xlabel: 'R' + j,
        _run: r, _cum: cum[j],
      });
    }
    var yTicks = [];
    for (var k=0;k<=3;k++) { var v = bot + (top - bot)*k/3; var y = Y(v); yTicks.push({ y: y.toFixed(1), ty: (y+4).toFixed(1), label: abbr(v) }); }
    return { line: line, area: area, points: points, yTicks: yTicks, cum: cum, n: n, X: X, Y: Y };
  }

  // ----- data init -----
  function initData(force) {
    var fLoc = $('f-loc'), eLoc = $('e-loc'), fCom = $('f-com');
    fLoc.disabled = true; eLoc.disabled = true; fCom.disabled = true;
    fLoc.innerHTML = '<option value="">Loading terminals…</option>';
    eLoc.innerHTML = '<option value="">Loading terminals…</option>';
    fCom.innerHTML = '<option value="">Loading commodities…</option>';
    if (force) { UEX.clearCache(); pricePromises = {}; $('btn-refresh').classList.add('spinning'); }
    Promise.all([UEX.getCommodities(), UEX.getTerminals()]).then(function(res){
      state.commodities = res[0];
      state.terminals = res[1];
      $('uex-banner').classList.add('hidden');
      populateSystemFilter();
      populateSelects();
      fLoc.disabled = false; eLoc.disabled = false; fCom.disabled = false;
    }).catch(function(){
      $('uex-banner').classList.remove('hidden');
      fLoc.innerHTML = '<option value="">Data unavailable</option>';
      eLoc.innerHTML = '<option value="">Data unavailable</option>';
      fCom.innerHTML = '<option value="">Data unavailable</option>';
      fLoc.disabled = true; eLoc.disabled = true; fCom.disabled = true;
    }).then(function(){
      $('btn-refresh').classList.remove('spinning');
    });
  }

  function populateSystemFilter() {
    var sel = $('sys-filter');
    var systems = [];
    state.terminals.forEach(function(t){ if (systems.indexOf(t.system) === -1) systems.push(t.system); });
    systems.sort(function(a,b){ return a.localeCompare(b); });
    var html = '<option value="all">All systems</option>';
    systems.forEach(function(s){ html += '<option value="' + esc(s) + '">' + esc(s) + '</option>'; });
    sel.innerHTML = html;
    if (settings.system !== 'all' && systems.indexOf(settings.system) === -1) settings.system = 'all';
    sel.value = settings.system;
  }

  function buildTerminalSelect(sel, stateKey, filterIds) {
    var prev = state[stateKey];
    sel.innerHTML = '';
    var ph = document.createElement('option'); ph.value = ''; ph.textContent = 'Select terminal…'; sel.appendChild(ph);
    var groups = {}, order = [];
    state.terminals.forEach(function(t){
      if (settings.system !== 'all' && t.system !== settings.system) return;
      if (filterIds && !filterIds[String(t.id)]) return;
      if (!groups[t.system]) { groups[t.system] = []; order.push(t.system); }
      groups[t.system].push(t);
    });
    var exists = false;
    order.forEach(function(sys){
      var og = document.createElement('optgroup');
      og.label = sys;
      groups[sys].forEach(function(t){
        var o = document.createElement('option');
        o.value = String(t.id); o.textContent = t.name;
        og.appendChild(o);
        if (String(t.id) === prev) exists = true;
      });
      sel.appendChild(og);
    });
    if (prev && exists) { sel.value = prev; }
    else if (prev && !exists) { state[stateKey] = ''; sel.value = ''; }
  }

  function rebuildCommoditySelect() {
    var fc = $('f-com');
    var prevCom = state.fCom;
    fc.innerHTML = '';
    var ph = document.createElement('option'); ph.value = ''; ph.textContent = 'Select cargo…'; fc.appendChild(ph);
    var comExists = false;
    state.commodities.forEach(function(c){
      if (state.buyableIds && !state.buyableIds[String(c.id)]) return;
      var o = document.createElement('option');
      o.value = String(c.id); o.textContent = c.name;
      fc.appendChild(o);
      if (String(c.id) === prevCom) comExists = true;
    });
    if (prevCom && comExists) { fc.value = prevCom; }
    else if (prevCom && !comExists) { state.fCom = ''; fc.value = ''; updateBuyPrefill(); }
  }

  function updateBuyableFilter() {
    if (!state.fLoc) {
      state.buyableIds = null;
      rebuildCommoditySelect();
      return;
    }
    var token = state.fLoc;
    getPricesFor(state.fLoc).then(function(rows){
      if (token !== state.fLoc) return;
      var ids = {};
      rows.forEach(function(r){ if (r.price_buy > 0) ids[String(r.id_commodity)] = true; });
      state.buyableIds = ids;
      rebuildCommoditySelect();
    }).catch(function(){
      if (token !== state.fLoc) return;
      state.buyableIds = null;
      rebuildCommoditySelect();
    });
  }

  function updateSellableFilter() {
    state.sellableIds = null;
    buildTerminalSelect($('e-loc'), 'eLoc', state.sellableIds);
    if (!state.active) return;
    var token = state.active.commodityId;
    UEX.getPricesByCommodity(state.active.commodityId).then(function(rows){
      if (!state.active || state.active.commodityId !== token) return;
      var ids = {};
      rows.forEach(function(r){ if (r.price_sell > 0) ids[String(r.id_terminal)] = true; });
      state.sellableIds = ids;
      var prevELoc = state.eLoc;
      buildTerminalSelect($('e-loc'), 'eLoc', state.sellableIds);
      if (prevELoc && !state.eLoc) updateSellPrefill();
    }).catch(function(){ /* leave sellableIds null (unfiltered) */ });
  }

  function populateSelects() {
    buildTerminalSelect($('f-loc'), 'fLoc', null);
    buildTerminalSelect($('e-loc'), 'eLoc', state.sellableIds);
    rebuildCommoditySelect();

    updateBuyableFilter();
    updateBuyPrefill();
    updateSellPrefill();
    updateLive();
  }

  // ----- actions -----
  function enterActive() {
    state.phase = 'active';
    $('e-loc').value = state.eLoc || '';
    $('e-sold').value = state.eSold;
    $('e-sell').value = state.eSell || '';
    setPhase();
    $('active-from').textContent = state.active.from;
    $('active-cargo').textContent = state.active.scu + ' SCU ' + state.active.commodity;
    $('elapsed').textContent = clock((Date.now() - state.active.startTime)/1000);
    $('sell-hint').classList.add('hidden');
    updateSellableFilter();
    updateLive();
  }

  function begin() {
    var amt = parseFloat(state.fAmt) || 0, buy = parseFloat(state.fBuy) || 0;
    if (!state.fLoc || !state.fCom || amt <= 0 || buy <= 0) return;
    state.active = {
      fromId: state.fLoc, from: terminalById(state.fLoc).name,
      commodityId: state.fCom, commodity: commodityById(state.fCom).name,
      scu: amt, buyPrice: buy, cost: amt*buy, startTime: Date.now()
    };
    Store.saveActive(state.active);
    state.eLoc = ''; state.eSold = String(amt); state.eSell = '';
    enterActive();
  }

  function cancel() {
    state.phase = 'idle'; state.active = null;
    Store.saveActive(null);
    state.fLoc = ''; state.fCom = ''; state.fAmt = ''; state.fBuy = '';
    state.eLoc = ''; state.eSold = ''; state.eSell = '';
    $('f-loc').value = ''; $('f-com').value = ''; $('f-amt').value = ''; $('f-buy').value = '';
    $('e-loc').value = ''; $('e-sold').value = ''; $('e-sell').value = '';
    $('sell-hint').classList.add('hidden');
    setPhase();
    state.buyableIds = null; state.sellableIds = null;
    populateSelects();
  }

  function complete() {
    var a = state.active; if (!a) return;
    var sold = parseFloat(state.eSold) || 0, sell = parseFloat(state.eSell) || 0;
    if (!state.eLoc || sold <= 0 || sell <= 0) return;
    var profit = sold*sell - a.cost;
    var dur = Math.max(1, Math.floor((Date.now() - a.startTime)/1000));
    var run = { commodity: a.commodity, from: a.from, to: terminalById(state.eLoc).name, scu: a.scu, profit: profit, dur: dur, ts: Date.now() };
    if (toastTimeout) clearTimeout(toastTimeout);
    state.runs.push(run);
    Store.saveRuns(state.runs);
    Store.saveActive(null);
    state.phase = 'idle'; state.active = null; state.hovered = -1;
    state.fLoc = ''; state.fCom = ''; state.fAmt = ''; state.fBuy = '';
    state.eLoc = ''; state.eSold = ''; state.eSell = '';
    $('f-loc').value = ''; $('f-com').value = ''; $('f-amt').value = ''; $('f-buy').value = '';
    $('e-loc').value = ''; $('e-sold').value = ''; $('e-sell').value = '';
    $('sell-hint').classList.add('hidden');
    setPhase();
    state.buyableIds = null; state.sellableIds = null;
    populateSelects();
    updateHeader();
    renderChart();
    renderLog();
    showToast(profit);
  }

  function showToast(profit) {
    $('toast-text').textContent = (profit>=0?'+':'') + fmt(profit) + ' aUEC';
    $('toast-text').style.color = profit>=0 ? '#a6e3a1' : '#f38ba8';
    $('toast').classList.remove('hidden');
    toastTimeout = setTimeout(function(){ $('toast').classList.add('hidden'); }, 5000);
  }

  // ----- DOM updates -----
  var beginBase = 'width:100%;border:none;border-radius:12px;font-size:15px;font-weight:700;padding:15px 18px;letter-spacing:.02em;transition:transform .1s;';
  var cBase = 'flex:1;border:none;border-radius:12px;font-size:14px;font-weight:700;padding:14px 18px;transition:transform .1s;';

  function setPhase() {
    if (state.phase === 'idle') { $('panel-idle').classList.remove('hidden'); $('panel-active').classList.add('hidden'); }
    else { $('panel-idle').classList.add('hidden'); $('panel-active').classList.remove('hidden'); }
  }

  function updateHeader() {
    var ch = buildChart(state.runs);
    var total = ch.cum[ch.n-1] || 0;
    var totalDur = state.runs.reduce(function(s,r){ return s+r.dur; }, 0);
    var perHr = totalDur > 0 ? total/(totalDur/3600) : 0;
    var best = state.runs.reduce(function(m,r){ return Math.max(m, r.profit); }, 0);
    $('stat-total').textContent = abbr(total);
    $('stat-runs').textContent = state.runs.length;
    $('stat-perhr').textContent = abbr(perHr);
    $('chart-total').textContent = fmt(total);
    $('log-count').textContent = state.runs.length + ' entries · best ' + abbr(best);
  }

  function updatePlan() {
    var amt = parseFloat(state.fAmt) || 0, buy = parseFloat(state.fBuy) || 0;
    $('plan-cost').textContent = amt > 0 && buy > 0 ? fmt(amt*buy) : '0';
    var beginDisabled = !(state.fLoc && state.fCom && amt > 0 && buy > 0);
    var btn = $('btn-begin');
    btn.disabled = beginDisabled;
    btn.style.cssText = beginDisabled
      ? beginBase + 'background:#313244;color:#585b70;cursor:not-allowed;'
      : beginBase + 'background:linear-gradient(135deg,#a6e3a1,#94e2d5);color:#11111b;cursor:pointer;box-shadow:0 10px 30px -10px rgba(166,227,161,.6);';
  }

  function updateBuyPrefill() {
    var hint = $('com-hint');
    function showGlobal() {
      var c = commodityById(state.fCom);
      if (c && c.price_buy > 0) {
        hint.textContent = 'ref ~' + c.price_buy + ' aUEC/SCU (avg)';
        hint.classList.remove('hidden');
      } else {
        hint.classList.add('hidden');
      }
    }
    updatePlan();
    if (state.fLoc && state.fCom) {
      var token = state.fLoc + '|' + state.fCom;
      getPricesFor(state.fLoc).then(function(rows){
        if (token !== state.fLoc + '|' + state.fCom) return;
        var row = null;
        for (var i=0;i<rows.length;i++){ if (String(rows[i].id_commodity) === state.fCom){ row = rows[i]; break; } }
        if (row && row.price_buy > 0) {
          state.fBuy = String(row.price_buy);
          $('f-buy').value = state.fBuy;
          hint.textContent = 'ref ~' + row.price_buy + ' aUEC/SCU';
          hint.classList.remove('hidden');
        } else {
          showGlobal();
        }
        updatePlan();
      }).catch(function(){
        if (token !== state.fLoc + '|' + state.fCom) return;
        showGlobal();
        updatePlan();
      });
    } else if (state.fCom) {
      showGlobal();
    } else {
      hint.classList.add('hidden');
    }
  }

  function updateSellPrefill() {
    var hint = $('sell-hint');
    var a = state.active;
    updateLive();
    if (!a || !state.eLoc) { hint.classList.add('hidden'); return; }
    var token = state.eLoc + '|' + a.commodityId;
    getPricesFor(state.eLoc).then(function(rows){
      if (token !== state.eLoc + '|' + a.commodityId) return;
      var row = null;
      for (var i=0;i<rows.length;i++){ if (String(rows[i].id_commodity) === String(a.commodityId)){ row = rows[i]; break; } }
      if (row && row.price_sell > 0) {
        state.eSell = String(row.price_sell);
        $('e-sell').value = state.eSell;
        hint.textContent = 'sells ~' + row.price_sell + ' aUEC/SCU here';
        hint.classList.remove('hidden');
      } else {
        hint.textContent = 'no sell price data for this terminal';
        hint.classList.remove('hidden');
      }
      updateLive();
    }).catch(function(){
      if (token !== state.eLoc + '|' + a.commodityId) return;
      hint.classList.add('hidden');
    });
  }

  function updateLive() {
    var a = state.active;
    var sold = parseFloat(state.eSold) || 0, sell = parseFloat(state.eSell) || 0;
    var liveRev = sold > 0 && sell > 0 ? sold*sell : 0;
    var liveProf = a ? liveRev - a.cost : 0;
    var profPos = liveProf >= 0;
    var hasVals = sold > 0 && sell > 0;
    $('live-rev').textContent = liveRev > 0 ? fmt(liveRev) : '—';
    $('live-profit').textContent = a && hasVals ? (profPos?'+':'') + fmt(liveProf) : '—';
    $('live-profit').style.color = !hasVals ? '#6c7086' : (profPos ? '#a6e3a1' : '#f38ba8');
    $('live-profit-box').style.borderColor = !hasVals ? '#313244' : (profPos ? 'rgba(166,227,161,.4)' : 'rgba(243,139,168,.4)');
    var completeDisabled = !(state.eLoc && sold > 0 && sell > 0);
    var btn = $('btn-complete');
    btn.disabled = completeDisabled;
    btn.style.cssText = completeDisabled
      ? cBase + 'background:#313244;color:#585b70;cursor:not-allowed;'
      : cBase + (profPos
          ? 'background:linear-gradient(135deg,#a6e3a1,#94e2d5);color:#11111b;cursor:pointer;box-shadow:0 10px 28px -10px rgba(166,227,161,.6);'
          : 'background:linear-gradient(135deg,#f38ba8,#eba0ac);color:#11111b;cursor:pointer;box-shadow:0 10px 28px -10px rgba(243,139,168,.6);');
  }

  function renderChart() {
    if (state.runs.length === 0) {
      $('chart-dyn').innerHTML = '';
      $('chart-empty').classList.remove('hidden');
      return;
    }
    $('chart-empty').classList.add('hidden');
    var ch = buildChart(state.runs);
    var html = '';
    ch.yTicks.forEach(function(t){
      html += '<line x1="44" y1="' + t.y + '" x2="798" y2="' + t.y + '" stroke="#313244" stroke-width="1" stroke-dasharray="2 5"></line>';
      html += '<text x="6" y="' + t.ty + '" fill="#585b70" font-size="11" font-family="JetBrains Mono, monospace">' + esc(t.label) + '</text>';
    });
    html += '<path d="' + ch.area + '" fill="url(#cl_fill)"></path>';
    html += '<path d="' + ch.line + '" fill="none" stroke="#a6e3a1" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" filter="url(#cl_glow)"></path>';
    if (state.hovered >= 1 && state.hovered < ch.n) {
      var hx = ch.X(state.hovered).toFixed(1);
      html += '<line x1="' + hx + '" y1="28" x2="' + hx + '" y2="262" stroke="#a6e3a1" stroke-width="1" stroke-dasharray="3 4" opacity="0.4"></line>';
    }
    var step = Math.ceil(ch.points.length/12);
    ch.points.forEach(function(p){
      html += '<circle cx="' + p.cx.toFixed(1) + '" cy="' + p.cy.toFixed(1) + '" r="' + p.r + '" fill="#181825" stroke="#a6e3a1" stroke-width="2.5"></circle>';
      html += '<circle cx="' + p.cx.toFixed(1) + '" cy="' + p.cy.toFixed(1) + '" r="16" fill="transparent" style="cursor:pointer" data-idx="' + p.idx + '"></circle>';
      if ((p.idx-1) % step === 0 || p.idx === ch.n-1) {
        html += '<text x="' + p.cx.toFixed(1) + '" y="284" fill="#585b70" font-size="11" font-family="JetBrains Mono, monospace" text-anchor="middle">' + esc(p.xlabel) + '</text>';
      }
    });
    if (ch.n > 1) {
      var lcx = ch.X(ch.n-1).toFixed(1), lcy = ch.Y(ch.cum[ch.n-1]).toFixed(1);
      html += '<circle cx="' + lcx + '" cy="' + lcy + '" r="5" fill="#a6e3a1" style="transform-origin:center;transform-box:fill-box;animation:pulseRing 2s ease-out infinite;"></circle>';
      html += '<circle cx="' + lcx + '" cy="' + lcy + '" r="4" fill="#a6e3a1"></circle>';
    }
    var g = $('chart-dyn');
    g.innerHTML = html;
    var hits = g.querySelectorAll('circle[data-idx]');
    hits.forEach(function(c){
      c.addEventListener('mouseenter', function(){
        var idx = parseInt(c.getAttribute('data-idx'), 10);
        if (state.hovered === idx) return;
        state.hovered = idx;
        renderChart();
        updateTooltip();
      });
    });
  }

  function updateTooltip() {
    var ch = buildChart(state.runs);
    var tip = $('chart-tooltip');
    if (state.hovered >= 1 && state.hovered < ch.n) {
      var r = state.runs[state.hovered-1];
      var cx = ch.X(state.hovered), cy = ch.Y(ch.cum[state.hovered]);
      tip.classList.remove('hidden');
      tip.style.left = (cx/820*100).toFixed(2) + '%';
      tip.style.top = (cy/300*100).toFixed(2) + '%';
      $('tip-com').textContent = r.commodity;
      $('tip-route').textContent = r.from + '  →  ' + r.to;
      $('tip-delta').textContent = '+' + fmt(r.profit);
      $('tip-cum').textContent = fmt(ch.cum[state.hovered]);
    } else {
      tip.classList.add('hidden');
    }
  }

  function renderLog() {
    if (state.runs.length === 0) {
      $('log-rows').innerHTML = '<div style="padding:28px 22px;text-align:center;color:#585b70;font-size:13px;">No runs logged yet</div>';
      return;
    }
    var html = '';
    var reversed = state.runs.slice().reverse();
    reversed.forEach(function(r, i){
      var originalIndex = state.runs.length - 1 - i;
      var perHr = abbr(r.dur > 0 ? r.profit/(r.dur/3600) : 0) + '/h';
      var profit = (r.profit>=0?'+':'') + abbr(r.profit);
      var profitColor = r.profit>=0 ? '#a6e3a1' : '#f38ba8';
      var dot = DOTS[originalIndex % DOTS.length];
      html += '<div class="log-row" style="display:grid;grid-template-columns:1.3fr 1.6fr 0.6fr 0.9fr 1fr 1fr;gap:12px;padding:14px 22px;border-bottom:1px solid #1e1e2e;align-items:center;">'
        + '<div style="display:flex;align-items:center;gap:9px;min-width:0;">'
        + '<div style="width:7px;height:7px;border-radius:2px;background:' + dot + ';flex:none;"></div>'
        + '<span style="font-size:14px;font-weight:500;color:#cdd6f4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.commodity) + '</span>'
        + '</div>'
        + '<div style="font-size:12px;color:#a6adc8;font-family:\'JetBrains Mono\',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.from + ' → ' + r.to) + '</div>'
        + '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:13px;color:#94e2d5;">' + esc(r.scu) + '</div>'
        + '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:13px;color:#6c7086;">' + esc(clock(r.dur)) + '</div>'
        + '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:13px;color:#89b4fa;">' + esc(perHr) + '</div>'
        + '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:14px;font-weight:700;color:' + profitColor + ';">' + esc(profit) + '</div>'
        + '<button class="log-del" data-i="' + originalIndex + '" title="Delete run">✕</button>'
        + '</div>';
    });
    $('log-rows').innerHTML = html;
    var dels = $('log-rows').querySelectorAll('.log-del');
    dels.forEach(function(b){
      b.addEventListener('click', function(){
        var idx = parseInt(b.getAttribute('data-i'), 10);
        state.runs.splice(idx, 1);
        Store.saveRuns(state.runs);
        state.hovered = -1;
        updateHeader();
        renderChart();
        updateTooltip();
        renderLog();
      });
    });
  }

  // ----- wiring -----
  var chips = document.querySelectorAll('.chip');
  chips.forEach(function(c){
    c.addEventListener('click', function(){
      state.fAmt = c.getAttribute('data-amt');
      $('f-amt').value = state.fAmt;
      updatePlan();
    });
  });

  $('f-loc').addEventListener('change', function(e){ state.fLoc = e.target.value; updateBuyableFilter(); updateBuyPrefill(); });
  $('f-com').addEventListener('change', function(e){ state.fCom = e.target.value; updateBuyPrefill(); });
  $('f-amt').addEventListener('input', function(e){ state.fAmt = e.target.value; updatePlan(); });
  $('f-buy').addEventListener('input', function(e){ state.fBuy = e.target.value; updatePlan(); });

  $('e-loc').addEventListener('change', function(e){ state.eLoc = e.target.value; updateSellPrefill(); });
  $('e-sold').addEventListener('input', function(e){ state.eSold = e.target.value; updateLive(); });
  $('e-sell').addEventListener('input', function(e){ state.eSell = e.target.value; updateLive(); });

  $('sys-filter').addEventListener('change', function(e){
    settings.system = e.target.value;
    Store.saveSettings(settings);
    populateSelects();
    updateBuyPrefill();
  });
  $('btn-refresh').addEventListener('click', function(){ initData(true); });
  $('btn-retry').addEventListener('click', function(){ initData(false); });

  $('btn-begin').addEventListener('click', begin);
  $('btn-abort').addEventListener('click', cancel);
  $('btn-complete').addEventListener('click', complete);

  $('chart-wrap').addEventListener('mouseleave', function(){
    state.hovered = -1;
    renderChart();
    updateTooltip();
  });

  setInterval(function(){
    if (state.active) {
      $('elapsed').textContent = clock((Date.now() - state.active.startTime)/1000);
    }
  }, 1000);

  // ----- boot -----
  var a = Store.loadActive();
  if (a && a.startTime) { state.active = a; state.phase = 'active'; state.eSold = String(a.scu); enterActive(); }

  updateHeader();
  updatePlan();
  renderChart();
  renderLog();
  initData(false);
