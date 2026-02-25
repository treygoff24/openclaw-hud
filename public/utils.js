// Shared utility functions
function escapeHtml(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

// Make escapeHtml available globally for other scripts
window.escapeHtml = escapeHtml;

window.HUD = window.HUD || {};
HUD.utils = {
  wsUrl: function (loc) {
    const l = loc || window.location;
    const protocol = l.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${l.host}`;
  },
  timeAgo: function (ms) {
    if (!ms) return "—";
    const diff = Date.now() - ms;
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  },
};
