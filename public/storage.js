// HUD Storage Module — Safe localStorage wrapper with quota handling
(function() {
  'use strict';
  var PREFIX = 'hud-';

  function safeParse(json) {
    try { return JSON.parse(json); } catch (e) { return null; }
  }

  var Storage = {
    get: function(key, defaultValue) {
      try {
        var raw = localStorage.getItem(PREFIX + key);
        if (raw === null) return defaultValue !== undefined ? defaultValue : null;
        var parsed = safeParse(raw);
        return parsed !== null ? parsed : defaultValue !== undefined ? defaultValue : null;
      } catch (e) {
        return defaultValue !== undefined ? defaultValue : null;
      }
    },

    set: function(key, value, options) {
      options = options || {};
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
          console.warn('HUD.Storage: Quota exceeded for key', key);
        }
        return false;
      }
    },

    remove: function(key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) {}
    },

    getStorageInfo: function() {
      var used = 0;
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) {
            var v = localStorage.getItem(k);
            if (v) used += v.length * 2;
          }
        }
      } catch (e) {}
      return { used: used, available: true, percentUsed: 0, itemCount: 0 };
    },

    clearNamespace: function() {
      try {
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) localStorage.removeItem(k);
        }
      } catch (e) {}
    },

    isAvailable: function() {
      try {
        var test = '__hud_test__';
        localStorage.setItem(test, '1');
        localStorage.removeItem(test);
        return true;
      } catch (e) { return false; }
    }
  };

  window.HUD = window.HUD || {};
  HUD.Storage = Storage;
})();
