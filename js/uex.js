var UEX = (function(){
  var BASE = 'https://api.uexcorp.space/2.0';

  function cacheGet(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.ts === 'number') return parsed;
      return null;
    } catch (e) { return null; }
  }

  function cacheSet(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) { /* ignore quota errors */ }
  }

  function fetchJSON(path) {
    return fetch(BASE + path).then(function(res){
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(body){
      if (!body || body.status !== 'ok') throw new Error('UEX status not ok');
      return body.data;
    });
  }

  function cached(key, ttlMs, fetcher) {
    var c = cacheGet(key);
    if (c && (Date.now() - c.ts) < ttlMs) return Promise.resolve(c.data);
    return fetcher().then(function(data){
      cacheSet(key, data);
      return data;
    }).catch(function(err){
      if (c) return c.data;
      throw err;
    });
  }

  function getCommodities() {
    return cached('cargoLedger.uex.commodities', 24*60*60*1000, function(){
      return fetchJSON('/commodities').then(function(rows){
        return rows.filter(function(r){ return r.is_available === 1 && r.is_visible === 1; })
          .map(function(r){ return { id: r.id, name: r.name, price_buy: r.price_buy, price_sell: r.price_sell }; })
          .sort(function(a,b){ return a.name.localeCompare(b.name); });
      });
    });
  }

  function getTerminals() {
    return cached('cargoLedger.uex.terminals', 24*60*60*1000, function(){
      return fetchJSON('/terminals?type=commodity').then(function(rows){
        return rows.filter(function(r){ return r.is_available === 1; })
          .map(function(r){ return { id: r.id, name: r.name, nickname: r.nickname, system: r.star_system_name || 'Unknown' }; })
          .sort(function(a,b){
            var s = a.system.localeCompare(b.system);
            return s !== 0 ? s : a.name.localeCompare(b.name);
          });
      });
    });
  }

  function getPrices(terminalId) {
    return cached('cargoLedger.uex.prices.' + terminalId, 60*60*1000, function(){
      return fetchJSON('/commodities_prices?id_terminal=' + terminalId).then(function(rows){
        return rows.map(function(r){ return { id_commodity: r.id_commodity, price_buy: r.price_buy, price_sell: r.price_sell }; });
      });
    });
  }

  function getPricesByCommodity(commodityId) {
    return cached('cargoLedger.uex.cprices.' + commodityId, 60*60*1000, function(){
      return fetchJSON('/commodities_prices?id_commodity=' + commodityId).then(function(rows){
        return rows.map(function(r){ return { id_terminal: r.id_terminal, price_buy: r.price_buy, price_sell: r.price_sell }; });
      });
    });
  }

  function clearCache() {
    Object.keys(localStorage).forEach(function(k){
      if (k.indexOf('cargoLedger.uex.') === 0) localStorage.removeItem(k);
    });
  }

  return {
    getCommodities: getCommodities,
    getTerminals: getTerminals,
    getPrices: getPrices,
    getPricesByCommodity: getPricesByCommodity,
    clearCache: clearCache,
  };
})();
