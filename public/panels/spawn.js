window.HUD = window.HUD || {};
HUD.spawn = (function() {
  'use strict';
  const $ = s => document.querySelector(s);

  let _focusTrap = null;
  let _triggerElement = null;

  function open() {
    _triggerElement = document.activeElement;
    $('#spawn-error').style.display = 'none';
    $('#spawn-error').setAttribute('role', 'alert');
    $('#spawn-label').value = '';
    $('#spawn-mode').value = 'run';
    $('#spawn-timeout').value = '300';
    $('#spawn-files').value = '';
    $('#spawn-prompt').value = '';

    const agentSelect = $('#spawn-agent');
    const agents = (window._agents || []).map(a => a.id);
    agentSelect.innerHTML = agents.map(id =>
      `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`
    ).join('');

    const modelSelect = $('#spawn-model');
    if (window._modelAliases) {
      modelSelect.innerHTML = window._modelAliases.map(m =>
        `<option value="${escapeHtml(m.fullId)}">${escapeHtml(m.alias)}${m.fullId ? ' (' + escapeHtml(m.fullId.split('/').pop()) + ')' : ''}</option>`
      ).join('');
    }

    $('#spawn-modal').classList.add('active');
    $('#spawn-prompt').focus();

    // Activate focus trap
    if (window.FocusTrap) {
      _focusTrap = new window.FocusTrap($('#spawn-modal'));
      _focusTrap.activate();
    }

    // Announce to screen readers
    if (window.A11yAnnouncer) {
      window.A11yAnnouncer.announce('Spawn session dialog opened');
    }
  }

  function close() {
    // Deactivate focus trap before closing
    if (_focusTrap) {
      _focusTrap.deactivate();
      _focusTrap = null;
    }
    $('#spawn-modal').classList.remove('active');
    // Restore focus to trigger element
    if (_triggerElement && _triggerElement.focus) {
      _triggerElement.focus();
      _triggerElement = null;
    }
  }

  async function launch() {
    const btn = $('#spawn-launch-btn');
    const errorEl = $('#spawn-error');
    errorEl.style.display = 'none';

    const data = {
      agentId: $('#spawn-agent').value,
      model: $('#spawn-model').value || undefined,
      label: $('#spawn-label').value.trim() || undefined,
      mode: $('#spawn-mode').value,
      timeout: parseInt($('#spawn-timeout').value) || undefined,
      contextFiles: $('#spawn-files').value || undefined,
      prompt: $('#spawn-prompt').value,
    };

    if (!data.prompt?.trim()) {
      errorEl.textContent = 'Task / Prompt is required';
      errorEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = 'LAUNCHING...';

    try {
      const res = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Spawn failed');

      close();
      HUD.showToast(`Session launched: ${data.label || data.agentId}`);
      setTimeout(HUD.fetchAll, 2000);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  function newSession() {
    const agentId = (window.ChatState && window.ChatState.currentSession)
      ? window.ChatState.currentSession.agentId
      : (window._agents && window._agents.length ? window._agents[0].id : null);
    console.log('[spawn] newSession:', { agentId, hasCurrentSession: !!(window.ChatState && window.ChatState.currentSession), agentCount: (window._agents || []).length });
    if (!agentId) return;
    window.ChatState.sendWs({ type: 'chat-new', agentId, source: 'tree' });
  }

  function init() {
    $('#new-session-btn').addEventListener('click', newSession);
    $('#open-spawn-btn').addEventListener('click', open);
    $('#spawn-cancel-btn').addEventListener('click', close);
    $('#spawn-modal-close').addEventListener('click', close);
    $('#spawn-launch-btn').addEventListener('click', launch);
    $('#spawn-modal').addEventListener('click', (e) => {
      if (e.target.id === 'spawn-modal') close();
    });
  }

  return { open, close, launch, newSession, init };
})();
