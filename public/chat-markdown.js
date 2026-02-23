// Chat Markdown Module — markdown rendering + sanitization
(function() {
  'use strict';

  var escapeHtml = window.escapeHtml || function(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };

  var markedAvailable = typeof marked !== 'undefined';
  var purifyAvailable = typeof DOMPurify !== 'undefined';

  var PURIFY_CONFIG = {
    ALLOWED_TAGS: ['p','br','strong','em','a','ul','ol','li','h1','h2','h3','h4','h5','h6',
      'pre','code','blockquote','table','thead','tbody','tr','th','td','hr','del','sup','sub'],
    ALLOWED_ATTR: ['href','target','rel'],
    ALLOW_DATA_ATTR: false,
  };

  function initMarked() {
    if (!markedAvailable) return;
    marked.setOptions({ gfm: true, breaks: true });
    marked.use({ renderer: { link: function(token) {
      if (/^javascript:/i.test(token.href)) {
        return this.parser.parseInline(token.tokens);
      }
      return '<a href="' + token.href + '" target="_blank" rel="noopener noreferrer">' + this.parser.parseInline(token.tokens) + '</a>';
    }}});
  }

  function renderMarkdown(text) {
    if (!text) return '';
    if (!markedAvailable) return escapeHtml(text);
    var raw = marked.parse(text);
    if (!purifyAvailable) {
      console.warn('DOMPurify not loaded \u2014 falling back to plain text for safety');
      return escapeHtml(text);
    }
    return DOMPurify.sanitize(raw, PURIFY_CONFIG);
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
