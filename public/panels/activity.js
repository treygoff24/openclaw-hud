window.HUD = window.HUD || {};
HUD.activity = (function () {
  "use strict";
  const $ = (s) => document.querySelector(s);

  let _previousCount = 0;

  function buildActivityHTML(events) {
    const safeEvents = Array.isArray(events) ? events : [];
    return safeEvents
      .map((e) => {
        const t = new Date(e.timestamp);
        const time = t.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        });
        let content = e.content || e.type || "";
        if (e.toolName) content = `⚡ ${e.toolName}`;
        return `<div class="activity-item" role="listitem" aria-label="${escapeHtml(e.type || "activity")} from ${escapeHtml(e.agentId || "unknown")} at ${time}">
        <span class="activity-time" aria-hidden="true">${time}</span>
        <span class="activity-type ${escapeHtml(e.type || "session")}" aria-hidden="true">${escapeHtml(e.type || "?")}</span>
        <span class="activity-agent" aria-hidden="true">${escapeHtml(e.agentId)}</span>
        <span class="activity-content" aria-hidden="true">${escapeHtml(content)}</span>
      </div>`;
      })
      .join("");
  }

  function render(events) {
    const safeEvents = Array.isArray(events) ? events : [];
    const newCount = safeEvents.length;
    const hasNewActivity = newCount > _previousCount;
    _previousCount = newCount;

    $("#activity-count").textContent = newCount;
    
    const activityFeed = $("#activity-feed");
    const html = buildActivityHTML(safeEvents);
    const temp = document.createElement("div");
    temp.innerHTML = html;
    
    if (typeof morphdom !== "undefined") {
      morphdom(activityFeed, temp, { childrenOnly: true });
    } else {
      activityFeed.innerHTML = html;
    }

    // Announce new activity to screen readers
    if (hasNewActivity && window.A11yAnnouncer && safeEvents.length > 0) {
      const latest = safeEvents[0];
      const activityDesc = latest.toolName
        ? `tool use: ${latest.toolName}`
        : latest.content || latest.type || "activity";
      window.A11yAnnouncer.announce(
        `${latest.agentId || "System"}: ${activityDesc}`,
        "activity-feed",
        1000,
      );
    }
  }

  return { render };
})();
