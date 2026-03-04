window.HUD = window.HUD || {};
HUD.sessions = (function () {
  "use strict";
  const $ = (s) => document.querySelector(s);

  function applyFocusableSessionRows() {
    if (typeof window.makeFocusable !== "function") return;
    const sessionsList = $("#sessions-list");
    if (!sessionsList) return;
    const rows = sessionsList.querySelectorAll(".session-row");
    rows.forEach((row) => {
      window.makeFocusable(row, function () {});
    });
  }

  function buildSessionsHTML(sessions) {
    return sessions
      .slice(0, 40)
      .map((s, index) => {
        const sessionKey = s.sessionKey;
        if (!sessionKey || typeof sessionKey !== "string") {
          throw new Error("sessions.render requires canonical sessionKey for each session");
        }
        const meta = window.SessionLabels.getDisplayMeta(s);
        const rawLabel = s.label || sessionKey || s.sessionId?.slice(0, 8);
        const statusMap = {
          active: "status-dot-green",
          completed: "status-dot-completed",
          warm: "status-dot-amber",
          stale: "status-dot-gray",
        };
        const dotClass = statusMap[s.status] || "status-dot-gray";
        const fullContext = window.SessionLabels.buildSessionAriaLabel(s, meta);
        return `<div class="session-row" data-agent="${escapeHtml(s.agentId || "")}" data-session="${escapeHtml(s.sessionId || "")}" data-session-key="${escapeHtml(sessionKey)}" data-label="${escapeHtml(rawLabel || "")}" role="listitem" tabindex="0" title="${escapeHtml(fullContext)}" aria-label="${escapeHtml(fullContext)}" data-index="${index}">
        <div class="${dotClass}" aria-hidden="true"></div>
        <div class="session-agent">${escapeHtml(s.agentId || "?")}</div>
        <div class="session-label" title="${escapeHtml(fullContext)}"><span class="session-label-role">${escapeHtml(meta.roleLabel)}</span><span class="session-label-sep"> · </span><span class="session-label-model">${escapeHtml(meta.modelLabel)}</span><span class="session-label-sep"> · </span><span class="session-label-alias">${escapeHtml(meta.sessionAlias)}</span></div>
        <div class="session-age">${HUD.utils.timeAgo(s.updatedAt)}</div>
      </div>`;
      })
      .join("");
  }

  function render(sessions) {
    const safeSessions = Array.isArray(sessions) ? sessions : [];
    for (const s of safeSessions) {
      if (!s.sessionKey)
        throw new Error("sessions.render requires canonical sessionKey for each session");
    }
    $("#session-count").textContent = safeSessions.length;
    
    const sessionsList = $("#sessions-list");
    const html = buildSessionsHTML(safeSessions);
    const temp = document.createElement("div");
    temp.innerHTML = html;
    
    if (typeof morphdom !== "undefined") {
      morphdom(sessionsList, temp, { childrenOnly: true });
    } else {
      sessionsList.innerHTML = html;
    }

    applyFocusableSessionRows();
  }

  // Event delegation handler
  function handleSessionsClick(e) {
    const row = e.target.closest(".session-row");
    if (row) {
      const agent = row.dataset.agent;
      const session = row.dataset.session;
      const sessionKey = row.dataset.sessionKey;
      const label = row.dataset.label;
      if (agent && sessionKey) {
        openChatPane(agent, session || "", label || "", sessionKey);
      }
    }
  }

  // Keyboard handler
  function handleSessionsKeydown(e) {
    if (e.key === "Enter" || e.key === " ") {
      const row = e.target.closest(".session-row");
      if (row) {
        e.preventDefault();
        const agent = row.dataset.agent;
        const session = row.dataset.session;
        const sessionKey = row.dataset.sessionKey;
        const label = row.dataset.label;
        if (agent && sessionKey) {
          openChatPane(agent, session || "", label || "", sessionKey);
        }
      }
    }
  }

  function init() {
    const sessionsList = $("#sessions-list");
    if (sessionsList) {
      sessionsList.addEventListener("click", handleSessionsClick);
      sessionsList.addEventListener("keydown", handleSessionsKeydown);
    }
  }

  // Auto-init when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { render, init };
})();
