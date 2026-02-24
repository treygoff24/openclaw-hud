(function() {
  'use strict';

  window.HUDApp = window.HUDApp || {};

  function createUiController(options) {
    const opts = options || {};
    const doc = opts.document || document;
    const $ = opts.querySelector || function(selector) { return doc.querySelector(selector); };
    const HUD = opts.HUD || window.HUD;
    const openChatPane = opts.openChatPane || window.openChatPane;
    let retryHandler = function() {};

    function showToast(message, isError) {
      const toast = $('#toast');
      if (!toast) return;

      toast.textContent = message;
      toast.className = 'toast' + (isError ? ' error' : '');
      requestAnimationFrame(function() {
        toast.classList.add('visible');
        setTimeout(function() {
          toast.classList.remove('visible');
        }, 3000);
      });
    }

    function renderPanelSafe(panelName, panelEl, renderFn, data) {
      if (!panelEl) {
        console.warn('Panel element not found: ' + panelName);
        return;
      }

      try {
        renderFn(panelEl, data);
      } catch (err) {
        console.error('Panel render failed: ' + panelName, err);
        panelEl.innerHTML =
          '<div class="panel-error">' +
            '<span class="panel-error-msg">—</span>' +
            '<button class="panel-retry-btn" onclick="retryPanel(\'' + panelName + '\')" title="Retry">↻</button>' +
          '</div>';
      }
    }

    function retryPanel(panelName) {
      console.log('Retrying panel: ' + panelName);
      retryHandler();
    }

    function setRetryHandler(fn) {
      retryHandler = typeof fn === 'function' ? fn : function() {};
    }

    function handleGlobalClick(event) {
      const cronRow = event.target.closest('[data-cron-id]');
      if (cronRow) {
        HUD.cron.openEditor(cronRow.dataset.cronId);
        return;
      }

      const row = event.target.closest('[data-agent][data-session-key]');
      if (row) {
        openChatPane(row.dataset.agent, row.dataset.session || '', row.dataset.label || '', row.dataset.sessionKey);
      }

      const card = event.target.closest('[data-agent-id]');
      if (card && !row) {
        HUD.agents.showAgentSessions(card.dataset.agentId);
      }
    }

    function handleTreeClick(event) {
      const toggle = event.target.closest('[data-toggle-key]');
      if (toggle) {
        HUD.sessionTree.toggleNode(toggle.dataset.toggleKey);
        event.stopPropagation();
        return;
      }

      const treeNode = event.target.closest('[data-tree-key]');
      if (treeNode && !event.target.closest('[data-toggle-key]')) {
        const agent = treeNode.dataset.agent;
        const session = treeNode.dataset.session;
        const sessionKey = treeNode.dataset.sessionKey;
        if (agent && sessionKey) {
          openChatPane(agent, session || '', treeNode.dataset.label || '', sessionKey);
        }
      }
    }

    function bindEscapeModalClose() {
      doc.addEventListener('keydown', function(event) {
        if (event.key !== 'Escape') return;

        const modals = ['#spawn-modal', '#cron-modal'];
        for (const id of modals) {
          const modal = $(id);
          if (!modal || !modal.classList.contains('active')) continue;
          event.preventDefault();
          modal.classList.remove('active');
          event.stopImmediatePropagation();
          return;
        }
      });
    }

    function bindDelegationHandlers() {
      doc.addEventListener('click', handleGlobalClick);
      doc.addEventListener('click', handleTreeClick);
      bindEscapeModalClose();
    }

    return {
      bindDelegationHandlers,
      showToast,
      renderPanelSafe,
      retryPanel,
      setRetryHandler,
    };
  }

  window.HUDApp.ui = {
    createUiController,
  };
})();
