window.HUD = window.HUD || {};
HUD.sessions = (function () {
  "use strict";
  const $ = (s) => document.querySelector(s);

  // Event delegation for clicks on session rows
  const sessionsList = $("#sessions-list");
  if (sessionsList) {
    sessionsList.addEventListener("click", (e) => {
      const row = e.target.closest(".session-row");
      if (row) {
        if (row.dataset.agent && row.dataset.sessionKey) {
          openChatPane(
            row.dataset.agent,
            row.dataset.session || "",
            row.dataset.label || "",
            row.dataset.sessionKey,
          );
        }
      }
    });
  }

  function render(sessions) {
    for (const s of sessions) {
      if (!s.sessionKey)
        throw new Error("sessions.render requires canonical sessionKey for each session");
    }
    $("#session-count").textContent = sessions.length;
    const html = sessions
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

    // Use morphdom instead of innerHTML for efficient DOM updates
    const temp = document.createElement("div");
    temp.innerHTML = html;
    morphdom($("#sessions-list"), temp, { childrenOnly: true });
  }

  return { render };
})();
