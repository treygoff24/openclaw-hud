// Chat Markdown Module — markdown rendering + sanitization
(function() {
  'use strict';

  var markedAvailable = typeof marked !== 'undefined';
  var purifyAvailable = typeof DOMPurify !== 'undefined';

  function initMarked() {
    if (!markedAvailable) return;
    marked.setOptions({ gfm: true, breaks: true });
  }

  function renderMarkdown(text) {
    if (!text) return '';
    if (!markedAvailable) return escapeHtml(text);
    var raw = marked.parse(text);
    return purifyAvailable ? DOMPurify.sanitize(raw) : escapeHtml(text);
  }

  function renderPlainText(text) {
    return escapeHtml(text || '');
  }

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMarked);
  } else {
    initMarked();
  }

  window.ChatMarkdown = {
    renderMarkdown: renderMarkdown,
    renderPlainText: renderPlainText,
    initMarked: initMarked,
  };
})();
