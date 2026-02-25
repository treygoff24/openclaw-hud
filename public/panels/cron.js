window.HUD = window.HUD || {};
HUD.cron = (function () {
  "use strict";
  const $ = (s) => document.querySelector(s);

  let _cronData = null;
  let _editingJobId = null;

  let _focusTrap = null;

  function render(data) {
    _cronData = data;
    const jobs = data.jobs || [];
    $("#cron-count").textContent = jobs.length;
    $("#cron-list").innerHTML = jobs
      .map((j, index) => {
        let dotClass = "status-dot-gray";
        if (j.enabled && j.state?.lastStatus === "completed") dotClass = "status-dot-green";
        else if (j.state?.lastStatus === "error") dotClass = "status-dot-red";
        else if (j.state?.lastStatus === "skipped") dotClass = "status-dot-amber";
        else if (j.enabled) dotClass = "status-dot-green";

        let statusText = j.state?.lastStatus || "unknown";
        let statusColor = "var(--text-dim)";
        if (statusText === "completed") statusColor = "var(--green)";
        else if (statusText === "error") statusColor = "var(--red)";
        else if (statusText === "skipped") statusColor = "var(--amber)";

        const lastRun = j.state?.lastRunAtMs ? HUD.utils.timeAgo(j.state.lastRunAtMs) : "never";
        const nextRun = j.state?.nextRunAtMs ? new Date(j.state.nextRunAtMs).toLocaleString() : "—";
        const errors =
          j.state?.consecutiveErrors > 0
            ? `<span style="color:var(--red)">errors: ${j.state.consecutiveErrors}</span>`
            : "";

        const modelInfo = j.usesDefaultModel
          ? `<span style="color:var(--text-dim)">default model</span>`
          : `<span style="color:var(--amber)">${escapeHtml(j.modelOverride || "?")}</span>`;

        const lastError = j.state?.lastError
          ? `<div style="color:var(--red);font-size:11px;margin-top:2px;">${escapeHtml(j.state.lastError)}</div>`
          : "";

        const enabledLabel = j.enabled ? "enabled" : "disabled";

        return `<div class="cron-row-v2" data-cron-id="${escapeHtml(j.id)}" role="listitem" tabindex="0" aria-label="Cron job ${escapeHtml(j.name)}, ${enabledLabel}, last status ${statusText}, agent ${escapeHtml(j.agentId || "none")}" data-index="${index}">
        <div class="${dotClass}" aria-hidden="true"></div>
        <div class="cron-main">
          <div class="cron-name">${escapeHtml(j.name)}
            <span class="cron-agent-tag">${escapeHtml(j.agentId || "")}</span>
          </div>
          <div class="cron-meta">
            <span class="cron-schedule">${escapeHtml(j.schedule?.expr || "?")} (${escapeHtml(j.schedule?.tz || "?")})</span>
            <span class="cron-model-info">${modelInfo}</span>
          </div>
          <div class="cron-status-row">
            <span style="color:${statusColor}">${escapeHtml(statusText).toUpperCase()}</span>
            <span style="color:var(--text-dim)">last: ${lastRun}</span>
            <span style="color:var(--text-dim)">next: ${nextRun}</span>
            ${errors}
          </div>
          ${lastError}
        </div>
      </div>`;
      })
      .join("");

    // Add keyboard support to cron rows
    document.querySelectorAll(".cron-row-v2").forEach((row) => {
      window.makeFocusable(row, () => openEditor(row.dataset.cronId));
    });
  }

  function openEditor(jobId) {
    if (!_cronData) return;
    const job = (_cronData.jobs || []).find((j) => j.id === jobId);
    if (!job) return;
    _editingJobId = jobId;

    $("#cron-edit-name").textContent = job.name || jobId;
    $("#cron-name").value = job.name || "";
    $("#cron-enabled").checked = !!job.enabled;

    const agentSelect = $("#cron-agent");
    const agents = (window._agents || []).map((a) => a.id);
    agentSelect.innerHTML = agents
      .map(
        (id) =>
          `<option value="${escapeHtml(id)}"${id === job.agentId ? " selected" : ""}>${escapeHtml(id)}</option>`,
      )
      .join("");

    $("#cron-session-target").value = job.sessionTarget || "main";
    updateSessionTargetFields();

    const sched = job.schedule || {};
    if (sched.at) {
      $("#cron-schedule-kind").value = "at";
      const d = new Date(sched.at);
      $("#cron-at").value = d.toISOString().slice(0, 16);
    } else {
      $("#cron-schedule-kind").value = "cron";
      $("#cron-expr").value = sched.expr || "";
      $("#cron-tz").value = sched.tz || "America/Chicago";
    }
    updateScheduleFields();

    const modelSelect = $("#cron-model");
    if (window._modelAliases) {
      modelSelect.innerHTML = window._modelAliases
        .map(
          (m) =>
            `<option value="${escapeHtml(m.fullId)}">${escapeHtml(m.alias)}${m.fullId ? " (" + escapeHtml(m.fullId.split("/").pop()) + ")" : ""}</option>`,
        )
        .join("");
    }

    const payload = job.payload || {};
    modelSelect.value = payload.model || "";
    $("#cron-timeout").value = payload.timeoutSeconds || "";
    $("#cron-prompt").value = payload.message || payload.text || "";

    $("#cron-modal").classList.add("active");

    // Activate focus trap
    if (window.FocusTrap) {
      _focusTrap = new window.FocusTrap($("#cron-modal"));
      _focusTrap.activate();
    }

    // Announce to screen readers
    if (window.A11yAnnouncer) {
      window.A11yAnnouncer.announce("Cron job editor opened for " + (job.name || jobId));
    }
  }

  function closeModal() {
    // Deactivate focus trap before closing
    if (_focusTrap) {
      _focusTrap.deactivate();
      _focusTrap = null;
    }
    $("#cron-modal").classList.remove("active");
    _editingJobId = null;
  }

  function updateSessionTargetFields() {
    const isIsolated = $("#cron-session-target").value === "isolated";
    $("#cron-model-group").style.display = isIsolated ? "" : "none";
    $("#cron-timeout-group").style.display = isIsolated ? "" : "none";
    $("#cron-prompt-label").textContent = isIsolated ? "Prompt / Task" : "System Event Message";
  }

  function updateScheduleFields() {
    const isCron = $("#cron-schedule-kind").value === "cron";
    $("#cron-expr-group").style.display = isCron ? "" : "none";
    $("#cron-tz-group").style.display = isCron ? "" : "none";
    $("#cron-at-group").style.display = isCron ? "none" : "";
  }

  async function save() {
    if (!_editingJobId) return;
    const sessionTarget = $("#cron-session-target").value;
    const isIsolated = sessionTarget === "isolated";
    const isCron = $("#cron-schedule-kind").value === "cron";

    const schedule = isCron
      ? { kind: "cron", expr: $("#cron-expr").value, tz: $("#cron-tz").value || "America/Chicago" }
      : { kind: "at", at: new Date($("#cron-at").value).toISOString() };

    const payloadKind = isIsolated ? "agentTurn" : "systemEvent";
    const payload = { kind: payloadKind };
    const promptVal = $("#cron-prompt").value;
    if (isIsolated) {
      payload.message = promptVal;
      if ($("#cron-model").value) payload.model = $("#cron-model").value;
      if ($("#cron-timeout").value) payload.timeoutSeconds = parseInt($("#cron-timeout").value);
    } else {
      payload.text = promptVal;
    }

    const updates = {
      name: $("#cron-name").value,
      enabled: $("#cron-enabled").checked,
      agentId: $("#cron-agent").value,
      sessionTarget,
      schedule,
      payload,
    };

    try {
      const res = await fetch(`/api/cron/${encodeURIComponent(_editingJobId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      closeModal();
      HUD.fetchAll();
    } catch (err) {
      alert("Error saving: " + err.message);
    }
  }

  function init() {
    $("#cron-session-target").addEventListener("change", updateSessionTargetFields);
    $("#cron-schedule-kind").addEventListener("change", updateScheduleFields);
    $("#cron-modal-close").onclick = closeModal;
    $("#cron-modal").addEventListener("click", (e) => {
      if (e.target === $("#cron-modal")) closeModal();
    });
  }

  return { render, openEditor, closeModal, save, init };
})();

// Global aliases for inline onclick handlers in HTML
function closeCronModal() {
  HUD.cron.closeModal();
}
function saveCronJob() {
  HUD.cron.save();
}
