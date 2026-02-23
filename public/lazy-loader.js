// Lazy Loader Module — Dynamic script loading for non-critical features
(function() {
  'use strict';

  const loadedModules = new Map();
  const loadingPromises = new Map();

  const moduleRegistry = {
    'chat-markdown': {
      url: 'chat-markdown.js',
      check: function() { return window.ChatMarkdown; },
      sizeEstimate: 5 // KB
    },
    'chat-progressive-render': {
      url: 'chat-progressive-render.js',
      check: function() { return window.ProgressiveToolRenderer; },
      sizeEstimate: 8 // KB
    },
    'chat-messages': {
      url: 'chat-messages.js',
      check: function() { return window.VirtualScroller; },
      sizeEstimate: 12 // KB
    },
    'chat-ws-batcher': {
      url: 'chat-ws-batcher.js',
      check: function() { return window.WebSocketMessageBatcher; },
      sizeEstimate: 4 // KB
    }
  };

  function loadScript(url) {
    return new Promise(function(resolve, reject) {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      
      script.onload = function() {
        resolve();
      };
      
      script.onerror = function() {
        reject(new Error('Failed to load: ' + url));
      };
      
      document.head.appendChild(script);
    });
  }

  function loadModule(moduleName) {
    // Return already loaded module
    if (loadedModules.has(moduleName)) {
      return Promise.resolve(loadedModules.get(moduleName));
    }
    
    // Return existing promise if loading in progress
    if (loadingPromises.has(moduleName)) {
      return loadingPromises.get(moduleName);
    }
    
    const module = moduleRegistry[moduleName];
    if (!module) {
      return Promise.reject(new Error('Unknown module: ' + moduleName));
    }
    
    // Check if already loaded via another means
    if (module.check()) {
      loadedModules.set(moduleName, module.check());
      return Promise.resolve(module.check());
    }
    
    // Load the module
    const loadPromise = loadScript(module.url)
      .then(function() {
        const instance = module.check();
        if (!instance) {
          throw new Error('Module loaded but not initialized: ' + moduleName);
        }
        loadedModules.set(moduleName, instance);
        loadingPromises.delete(moduleName);
        
        console.log('[LazyLoader] Loaded module:', moduleName);
        return instance;
      })
      .catch(function(err) {
        loadingPromises.delete(moduleName);
        throw err;
      });
    
    loadingPromises.set(moduleName, loadPromise);
    return loadPromise;
  }

  function loadModules(moduleNames) {
    return Promise.all(moduleNames.map(loadModule));
  }

  // Preload modules that will likely be needed
  function preloadModules(moduleNames) {
    // Use requestIdleCallback if available, otherwise setTimeout
    const schedule = window.requestIdleCallback || function(cb) { setTimeout(cb, 1); };
    
    schedule(function() {
      moduleNames.forEach(function(name) {
        // Only preload if not already loaded
        if (!loadedModules.has(name) && !loadingPromises.has(name)) {
          // Create a link element for preloading
          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.href = moduleRegistry[name].url;
          document.head.appendChild(link);
        }
      });
    });
  }

  // Auto-load critical modules on DOM ready
  function autoLoad() {
    // Load virtual scroller if chat pane exists
    const chatPane = document.getElementById('chat-messages');
    if (chatPane) {
      // Defer to next tick
      setTimeout(function() {
        loadModule('chat-messages').catch(function(err) {
          console.warn('[LazyLoader] Failed to load virtual scroller:', err);
        });
      }, 100);
    }
    
    // Preload markdown module (likely to be needed)
    preloadModules(['chat-markdown', 'chat-progressive-render']);
  }

  // Get loading stats
  function getStats() {
    const stats = {
      loaded: Array.from(loadedModules.keys()),
      loading: Array.from(loadingPromises.keys()),
      available: Object.keys(moduleRegistry),
      totalSize: 0
    };
    
    stats.loaded.forEach(function(name) {
      const mod = moduleRegistry[name];
      if (mod) {
        stats.totalSize += mod.sizeEstimate;
      }
    });
    
    return stats;
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoLoad);
  } else {
    autoLoad();
  }

  // Export
  window.LazyLoader = {
    load: loadModule,
    loadMultiple: loadModules,
    preload: preloadModules,
    getStats: getStats,
    _registry: moduleRegistry
  };
})();
