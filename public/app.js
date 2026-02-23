// app.js — Thin entry point: initialization, fetchAll, polling/WebSocket
(function() {
  'use strict';
  const $ = s => document.querySelector(s);

  // Uptime counter
  const pageStartTime = Date.now();
  function updateUptime() {
    const diff = Date.now() - pageStartTime;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const el = document.getElementById('stat-uptime');
    if (el) el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  setInterval(updateUptime, 1000);
  updateUptime();

  // Clock
  function updateClock() {
    const now = new Date();
    $('#clock').textContent = now.toLocaleString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Connection status
  let connected = true;
  function setConnectionStatus(ok) {
    connected = ok;
    let badge = document.getElementById('connection-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'connection-badge';
      badge.style.cssText = 'color:#ff1744;font-weight:bold;font-size:12px;margin-left:12px;font-family:var(--font-mono);';
      const header = $('header') || document.querySelector('.header') || document.body.firstElementChild;
      if (header) header.appendChild(badge);
    }
    badge.textContent = ok ? '' : '⚠ DISCONNECTED';
    badge.style.display = ok ? 'none' : 'inline';
  }

  // Event delegation for clickable rows
  document.addEventListener('click', e => {
    const cronRow = e.target.closest('[data-cron-id]');
    if (cronRow) {
      HUD.cron.openEditor(cronRow.dataset.cronId);
      return;
    }
    const row = e.target.closest('[data-agent][data-session]');
    if (row) {
      openChatPane(row.dataset.agent, row.dataset.session, row.dataset.label || '');
    }
    const card = e.target.closest('[data-agent-id]');
    if (card && !row) {
      HUD.agents.showAgentSessions(card.dataset.agentId);
    }
  });

  // Tree event delegation
  document.addEventListener('click', e => {
    const toggle = e.target.closest('[data-toggle-key]');
    if (toggle) {
      HUD.sessionTree.toggleNode(toggle.dataset.toggleKey);
      e.stopPropagation();
      return;
    }
    const treeNode = e.target.closest('[data-tree-key]');
    if (treeNode && !e.target.closest('[data-toggle-key]')) {
      const agent = treeNode.dataset.agent;
      const session = treeNode.dataset.session;
      if (agent && session) openChatPane(agent, session, treeNode.dataset.label || '');
    }
  });

  // Modal close on Escape
  function closeModal() {
    const modals = ['#spawn-modal', '#cron-modal'];
    for (const id of modals) {
      if ($(id).classList.contains('active')) {
        $(id).classList.remove('active');
        return;
      }
    }
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modals = ['#spawn-modal', '#cron-modal'];
      for (const id of modals) {
        if ($(id).classList.contains('active')) {
          e.preventDefault();
          $(id).classList.remove('active');
          e.stopImmediatePropagation();
          return;
        }
      }
    }
  });

  // Toast
  function showToast(message, isError = false) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.className = 'toast' + (isError ? ' error' : '');
    requestAnimationFrame(() => {
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 3000);
    });
  }
  HUD.showToast = showToast;

  // Fetch all data
  async function fetchAll() {
    try {
      const [agents, sessions, cron, config, usage, activity, tree, models] = await Promise.all([
        fetch('/api/agents').then(r => r.json()),
        fetch('/api/sessions').then(r => r.json()),
        fetch('/api/cron').then(r => r.json()),
        fetch('/api/config').then(r => r.json()),
        fetch('/api/model-usage').then(r => r.json()),
        fetch('/api/activity').then(r => r.json()),
        fetch('/api/session-tree').then(r => r.json()),
        fetch('/api/models').then(r => r.json()),
      ]);
      window._modelAliases = models;
      window._allSessions = sessions;
      HUD.agents.render(agents);
      HUD.sessions.render(sessions);
      HUD.cron.render(cron);
      HUD.system.render(config);
      HUD.models.render(usage);
      HUD.activity.render(activity);
      HUD.sessionTree.render(tree);
      setConnectionStatus(true);
    } catch (err) {
      console.error('Fetch error:', err);
      setConnectionStatus(false);
    }
  }
  HUD.fetchAll = fetchAll;

  // Initialize panels
  HUD.agents.init();
  HUD.cron.init();
  HUD.spawn.init();

  fetchAll();

  // Polling management
  let pollInterval = null;
  function startPolling() {
    if (!pollInterval) pollInterval = setInterval(fetchAll, 15000);
  }
  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }
  startPolling();

  // WebSocket for ticks
  try {
    const ws = new WebSocket(`ws://${location.host}`);
    window._hudWs = ws;
    ws.onopen = () => {
      stopPolling();
      setConnectionStatus(true);
      if (window._flushChatWsQueue) window._flushChatWsQueue();
    };
    ws.onmessage = e => {
      const data = JSON.parse(e.data);
      if (data.type === 'tick') fetchAll();
      if (window.handleChatWsMessage) window.handleChatWsMessage(data);
    };
    ws.onclose = () => {
      startPolling();
      setConnectionStatus(false);
    };
    ws.onerror = () => {
      setConnectionStatus(false);
    };
  } catch {}
})();
