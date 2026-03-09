window.HUD = window.HUD || {};
HUD.spawn = (function () {
  "use strict";
  const $ = (s) => document.querySelector(s);

  let _focusTrap = null;
  let _triggerElement = null;
  let _spawnPreflight = {
    ok: false,
    enabled: false,
    code: "SPAWN_PRECHECK_PENDING",
    status: "blocked",
    reason: "Spawn preflight is in progress. Start has not completed successfully.",
    diagnostics: [],
  };

  function applySpawnGateState(nextState) {
    _spawnPreflight = {
      ok: Boolean(nextState?.ok),
      enabled: Boolean(nextState?.enabled),
      code: typeof nextState?.code === "string" ? nextState.code : "READY",
      status: typeof nextState?.status === "string" ? nextState.status : "ready",
      reason: typeof nextState?.reason === "string" ? nextState.reason : "",
      diagnostics: Array.isArray(nextState?.diagnostics) ? nextState.diagnostics : [],
    };

    const openSpawnBtn = $("#open-spawn-btn");
    if (openSpawnBtn) {
      openSpawnBtn.disabled = !_spawnPreflight.enabled;
      openSpawnBtn.title = _spawnPreflight.enabled
        ? "Launch a new session"
        : "Spawn currently disabled";
    }

    const newSessionBtn = $("#new-session-btn");
    if (newSessionBtn) {
      newSessionBtn.disabled = !_spawnPreflight.enabled;
      if (!_spawnPreflight.enabled) {
        newSessionBtn.title = "Spawn currently disabled";
      }
    }
  }

  function getSpawnGateDiagnosticText() {
    const firstDiagnostic = _spawnPreflight.diagnostics && _spawnPreflight.diagnostics[0];
    if (firstDiagnostic?.message) return String(firstDiagnostic.message);
    if (_spawnPreflight.reason) return String(_spawnPreflight.reason);
    return "Spawn is currently unavailable.";
  }

  async function refreshPreflight() {
    const fallbackState = {
      ok: false,
      enabled: false,
      code: "SPAWN_PRECHECK_OFFLINE",
      status: "blocked",
      reason: "Spawn preflight endpoint is unavailable.",
      diagnostics: [
        {
          code: "SPAWN_PRECHECK_OFFLINE",
          message: "Spawn setup gate check failed. HUD cannot confirm spawn is ready.",
          remediation: "Start HUD after `/api/spawn-preflight` is reachable.",
        },
      ],
    };

    if (typeof fetch !== "function") {
      applySpawnGateState(fallbackState);
      return _spawnPreflight;
    }

    try {
      const res = await fetch("/api/spawn-preflight", { method: "GET" });
      if (!res.ok) throw new Error(`Preflight request failed (${res.status})`);
      const state = await res.json();
      applySpawnGateState(state);
    } catch {
      applySpawnGateState(fallbackState);
    }

    return _spawnPreflight;
  }

  function open() {
    if (!_spawnPreflight.enabled) {
      const errorEl = $("#spawn-error");
      errorEl.textContent = getSpawnGateDiagnosticText();
      errorEl.style.display = "block";
      return;
    }

    _triggerElement = document.activeElement;
    $("#spawn-error").style.display = "none";
    $("#spawn-error").setAttribute("role", "alert");
    $("#spawn-label").value = "";
    $("#spawn-timeout").value = "300";
    $("#spawn-files").value = "";
    $("#spawn-prompt").value = "";

    const agentSelect = $("#spawn-agent");
    const agents = (window._agents || []).map((a) => a.id);
    agentSelect.innerHTML = agents
      .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`)
      .join("");

    const modelSelect = $("#spawn-model");
    if (window._modelAliases) {
      modelSelect.innerHTML = window._modelAliases
        .map(
          (m) =>
            `<option value="${escapeHtml(m.fullId)}">${escapeHtml(m.alias)}${m.fullId ? " (" + escapeHtml(m.fullId.split("/").pop()) + ")" : ""}</option>`,
        )
        .join("");
    }

    $("#spawn-modal").classList.add("active");
    $("#spawn-prompt").focus();

    // Activate focus trap
    if (window.FocusTrap) {
      _focusTrap = new window.FocusTrap($("#spawn-modal"));
      _focusTrap.activate();
    }

    // Announce to screen readers
    if (window.A11yAnnouncer) {
      window.A11yAnnouncer.announce("Spawn session dialog opened");
    }
  }

  function close() {
    // Deactivate focus trap before closing
    if (_focusTrap) {
      _focusTrap.deactivate();
      _focusTrap = null;
    }
    $("#spawn-modal").classList.remove("active");
    // Restore focus to trigger element
    if (_triggerElement && _triggerElement.focus) {
      _triggerElement.focus();
      _triggerElement = null;
    }
  }

  async function launch() {
    const btn = $("#spawn-launch-btn");
    const errorEl = $("#spawn-error");
    if (!_spawnPreflight.enabled) {
      errorEl.textContent = getSpawnGateDiagnosticText();
      errorEl.style.display = "block";
      return;
    }

    errorEl.style.display = "none";

    const data = {
      agentId: $("#spawn-agent").value,
      model: $("#spawn-model").value || undefined,
      label: $("#spawn-label").value.trim() || undefined,
      mode: $("#spawn-mode").value || "session",
      timeout: parseInt($("#spawn-timeout").value) || undefined,
      contextFiles: $("#spawn-files").value || undefined,
      prompt: $("#spawn-prompt").value,
    };

    if (!data.prompt?.trim()) {
      errorEl.textContent = "Task / Prompt is required";
      errorEl.style.display = "block";
      return;
    }

    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = "LAUNCHING...";

    try {
      const res = await fetch("/api/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Spawn failed");

      close();
      HUD.showToast(`Session launched: ${data.label || data.agentId}`);
      setTimeout(function () {
        if (typeof HUD.fetchAll === "function") HUD.fetchAll();
      }, 2000);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  function newSession() {
    if (!_spawnPreflight.enabled) return;

    const agentId =
      window.ChatState && window.ChatState.currentSession
        ? window.ChatState.currentSession.agentId
        : window._agents && window._agents.length
          ? window._agents[0].id
          : null;
    console.log("[spawn] newSession:", {
      agentId,
      hasCurrentSession: !!(window.ChatState && window.ChatState.currentSession),
      agentCount: (window._agents || []).length,
    });
    if (!agentId) return;
    window.ChatState.sendWs({ type: "chat-new", agentId, source: "tree" });
  }

  function init() {
    const newSessionBtn = $("#new-session-btn");
    if (newSessionBtn) {
      newSessionBtn.addEventListener("click", newSession);
    }
    $("#open-spawn-btn").addEventListener("click", open);
    $("#spawn-cancel-btn").addEventListener("click", close);
    $("#spawn-modal-close").addEventListener("click", close);
    $("#spawn-launch-btn").addEventListener("click", launch);
    $("#spawn-modal").addEventListener("click", (e) => {
      if (e.target.id === "spawn-modal") close();
    });

    // Auto-populate label field with model alias when label is empty
    $("#spawn-model").addEventListener("change", function () {
      const labelField = $("#spawn-label");
      if (!labelField.value.trim()) {
        labelField.value = this.selectedOptions[0]?.text || "";
      }
    });

    if (typeof fetch === "function") {
      void refreshPreflight();
    }
  }

  return {
    open,
    close,
    launch,
    newSession,
    refreshPreflight,
    init,
  };
})();
