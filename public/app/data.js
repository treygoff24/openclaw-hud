(function() {
  'use strict';

  window.HUDApp = window.HUDApp || {};

  function createDataController(options) {
    const opts = options || {};
    const HUD = opts.HUD || window.HUD;
    const doc = opts.document || document;
    const renderPanelSafe = opts.renderPanelSafe;
    const setConnectionStatus = opts.setConnectionStatus;
    const onChatRestore = opts.onChatRestore;
    const getFetch = opts.getFetch || function() { return window.fetch.bind(window); };

    let hasAttemptedChatSessionRestore = false;

    async function fetchAll() {
      const endpoints = [
        { name: 'agents', url: '/api/agents' },
        { name: 'sessions', url: '/api/sessions' },
        { name: 'cron', url: '/api/cron' },
        { name: 'config', url: '/api/config' },
        { name: 'model-usage', url: '/api/model-usage/live-weekly' },
        { name: 'activity', url: '/api/activity' },
        { name: 'session-tree', url: '/api/session-tree' },
        { name: 'models', url: '/api/models' },
      ];

      try {
        const runFetch = getFetch();
        const results = await Promise.allSettled(
          endpoints.map(function(endpoint) {
            return runFetch(endpoint.url)
              .then(function(response) {
                return response.json();
              })
              .catch(function(err) {
                console.warn('Endpoint ' + endpoint.name + ' failed:', err);
                return null;
              });
          })
        );

        const data = {};
        results.forEach(function(result, index) {
          data[endpoints[index].name] = result.status === 'fulfilled' ? result.value : null;
        });

        window._modelAliases = data.models || [];
        window._allSessions = data.sessions || [];

        renderPanelSafe('agents', doc.getElementById('agents-list'), function(el, panelData) { HUD.agents.render(panelData); }, data.agents);
        renderPanelSafe('sessions', doc.getElementById('sessions-list'), function(el, panelData) { HUD.sessions.render(panelData); }, data.sessions);
        renderPanelSafe('cron', doc.getElementById('cron-list'), function(el, panelData) { HUD.cron.render(panelData); }, data.cron);
        renderPanelSafe('system', doc.getElementById('system-info'), function(el, panelData) { HUD.system.render(panelData); }, data.config);
        renderPanelSafe('models', doc.getElementById('model-usage'), function(el, panelData) { HUD.models.render(panelData); }, data['model-usage']);
        renderPanelSafe('activity', doc.getElementById('activity-feed'), function(el, panelData) { HUD.activity.render(panelData); }, data.activity);
        renderPanelSafe('session-tree', doc.getElementById('tree-body'), function(el, panelData) { HUD.sessionTree.render(panelData); }, data['session-tree']);

        if (!hasAttemptedChatSessionRestore && typeof onChatRestore === 'function' && data.sessions) {
          hasAttemptedChatSessionRestore = true;
          onChatRestore(data.sessions);
        }

        const hasAnyData = results.some(function(result) {
          return result.status === 'fulfilled' && result.value !== null;
        });
        setConnectionStatus(hasAnyData);
      } catch (err) {
        console.error('Fetch error:', err);
        setConnectionStatus(false);
      }
    }

    return {
      fetchAll,
    };
  }

  window.HUDApp.data = {
    createDataController,
  };
})();
