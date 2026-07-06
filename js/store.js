var Store = (function(){
  var K_RUNS = 'cargoLedger.runs';
  var K_ACTIVE = 'cargoLedger.activeRun';
  var K_SETTINGS = 'cargoLedger.settings';

  function loadRuns() {
    try {
      var raw = localStorage.getItem(K_RUNS);
      if (!raw) return [];
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function saveRuns(runs) {
    try { localStorage.setItem(K_RUNS, JSON.stringify(runs)); } catch (e) {}
  }

  function loadActive() {
    try {
      var raw = localStorage.getItem(K_ACTIVE);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return v || null;
    } catch (e) { return null; }
  }

  function saveActive(a) {
    try {
      if (!a) { localStorage.removeItem(K_ACTIVE); return; }
      localStorage.setItem(K_ACTIVE, JSON.stringify(a));
    } catch (e) {}
  }

  function loadSettings() {
    var def = { system: 'all' };
    try {
      var raw = localStorage.getItem(K_SETTINGS);
      if (!raw) return def;
      var v = JSON.parse(raw) || {};
      var out = { system: def.system };
      for (var k in v) { if (v.hasOwnProperty(k)) out[k] = v[k]; }
      return out;
    } catch (e) { return def; }
  }

  function saveSettings(s) {
    try { localStorage.setItem(K_SETTINGS, JSON.stringify(s)); } catch (e) {}
  }

  return {
    loadRuns: loadRuns,
    saveRuns: saveRuns,
    loadActive: loadActive,
    saveActive: saveActive,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
  };
})();
