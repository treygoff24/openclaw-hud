window.HUD = window.HUD || {};
HUD.agents = (function () {
  "use strict";
  const $ = (s) => document.querySelector(s);

  let agentFilter = "";

  function applyFocusableAgentCards() {
    if (typeof window.makeFocusable !== "function") return;
    const agentsList = $("#agents-list");
    if (!agentsList) return;
    const cards = agentsList.querySelectorAll(".agent-card");
    cards.forEach((card) => {
      window.makeFocusable(card, function () {});
    });
  }

  function buildAgentsHTML(agents) {
    const filtered = agents.filter((a) => a.id.toLowerCase().includes(agentFilter));
    const now = Date.now();
    let activeCount = 0;
    
    const html = filtered
      .map((a, index) => {
        const recent = a.sessions[0]?.updatedAt;
        const isActive = recent && now - recent < 600000;
        if (isActive) activeCount++;
        const dotClass = isActive ? "status-dot-green" : "status-dot-gray";
        const activeBadge =
          a.activeSessions > 0
            ? `<span style="color:var(--green);font-size:11px;margin-left:6px;">${a.activeSessions} live</span>`
            : "";
        const statusLabel = isActive ? "Active" : "Inactive";
        return `<div class="agent-card" data-agent-id="${escapeHtml(a.id)}" role="listitem" tabindex="0" aria-label="Agent ${escapeHtml(a.id)}, ${statusLabel}, ${a.sessionCount} sessions" data-index="${index}">
        <div class="${dotClass}" aria-hidden="true"></div>
        <div class="agent-id">${escapeHtml(a.id)}${activeBadge}</div>
        <div class="agent-sessions-count">${a.sessionCount} sess</div>
      </div>`;
      })
      .join("");
    
    return { html, filteredCount: filtered.length, activeCount, totalCount: agents.length };
  }

  function updateAgentsList() {
    const agentsList = $("#agents-list");
    if (!agentsList || !window._agents) return;
    
    const { html, filteredCount } = buildAgentsHTML(window._agents);
    const temp = document.createElement("div");
    temp.innerHTML = html;
    
    if (typeof morphdom !== "undefined") {
      morphdom(agentsList, temp, { childrenOnly: true });
    } else {
      agentsList.innerHTML = html;
    }

    applyFocusableAgentCards();
    
    $("#agent-count").textContent = filteredCount;
  }

  function render(agents) {
    window._agents = agents;
    const { filteredCount, activeCount, totalCount } = buildAgentsHTML(agents);
    
    const agentsList = $("#agents-list");
    const temp = document.createElement("div");
    temp.innerHTML = buildAgentsHTML(agents).html;
    
    if (typeof morphdom !== "undefined") {
      morphdom(agentsList, temp, { childrenOnly: true });
    } else {
      agentsList.innerHTML = buildAgentsHTML(agents).html;
    }

    applyFocusableAgentCards();
    
    $("#agent-count").textContent = filteredCount;

    const statAgents = document.getElementById("stat-agents");
    const statActive = document.getElementById("stat-active");
    if (statAgents) statAgents.textContent = totalCount;
    if (statActive) statActive.textContent = activeCount;
  }

  // Event delegation handler
  function handleAgentsClick(e) {
    const card = e.target.closest(".agent-card");
    if (card) {
      const agentId = card.dataset.agentId;
      if (agentId) {
        showAgentSessions(agentId);
      }
    }
  }

  // Keyboard handler for Enter/Space on agent cards
  function handleAgentsKeydown(e) {
    if (e.key === "Enter" || e.key === " ") {
      const card = e.target.closest(".agent-card");
      if (card) {
        e.preventDefault();
        const agentId = card.dataset.agentId;
        if (agentId) {
          showAgentSessions(agentId);
        }
      }
    }
  }

  function init() {
    const agentsList = $("#agents-list");
    if (agentsList) {
      agentsList.addEventListener("click", handleAgentsClick);
      agentsList.addEventListener("keydown", handleAgentsKeydown);
    }

    $("#agent-search").addEventListener("input", (e) => {
      agentFilter = e.target.value.toLowerCase();
      updateAgentsList();
    });

    // Add keyboard navigation for search
    $("#agent-search").addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.target.value = "";
        agentFilter = "";
        updateAgentsList();
      }
    });
  }

  function showAgentSessions(agentId) {
    const sessions = (window._allSessions || []).filter((s) => s.agentId === agentId);
    if (sessions.length === 0) {
      $("#sessions-list").innerHTML =
        `<div style="color:var(--text-dim);font-family:var(--font-mono);padding:16px;text-align:center;">No sessions for ${escapeHtml(agentId)}</div>`;
      $("#session-count").textContent = "0";
      return;
    }
    HUD.sessions.render(sessions);
  }

  // Auto-init when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { render, init, showAgentSessions };
})();
