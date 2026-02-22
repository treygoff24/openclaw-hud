window.HUD = window.HUD || {};
HUD.spawn = (function() {
  'use strict';
  const $ = s => document.querySelector(s);

  function open() {
    $('#spawn-error').style.display = 'none';
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
  }

  function close() {
    $('#spawn-modal').classList.remove('active');
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

  function init() {
    $('#open-spawn-btn').addEventListener('click', open);
    $('#spawn-cancel-btn').addEventListener('click', close);
    $('#spawn-modal-close').addEventListener('click', close);
    $('#spawn-launch-btn').addEventListener('click', launch);
    $('#spawn-modal').addEventListener('click', (e) => {
      if (e.target.id === 'spawn-modal') close();
    });
  }

  return { open, close, launch, init };
})();
