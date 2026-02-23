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
      'pre','code','blockquote','table','thead','tbody','tr','th','td','hr','del','sup','sub',
      'div','span','button'],
    ALLOWED_ATTR: ['href','target','rel','class','data-code','aria-label'],
    ALLOW_DATA_ATTR: true,
  };

  // Track code blocks for copy functionality
  var codeBlockCounter = 0;
  var codeBlocks = new Map();

  function initMarked() {
    if (!markedAvailable) return;
    marked.setOptions({ gfm: true, breaks: true });
    marked.use({ renderer: { 
      link: function(token) {
        if (/^javascript:/i.test(token.href)) {
          return this.parser.parseInline(token.tokens);
        }
        return '<a href="' + token.href + '" target="_blank" rel="noopener noreferrer">' + this.parser.parseInline(token.tokens) + '</a>';
      },
      code: function(token) {
        var id = 'code-' + (++codeBlockCounter);
        var code = token.text || '';
        var lang = token.lang || '';
        codeBlocks.set(id, code);
        return '<div class="code-block-wrapper" data-code-id="' + id + '">' +
          '<button type="button" class="code-copy-btn" aria-label="Copy code" data-code-id="' + id + '">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
          '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>' +
          '</svg>' +
          '</button>' +
          '<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>' + escapeHtml(code) + '</code></pre>' +
          '</div>';
      }
    }});
  }

  function renderMarkdown(text) {
    if (!text) return '';
    if (!markedAvailable) return escapeHtml(text);
    var raw = marked.parse(text);
    if (!purifyAvailable) {
      console.warn('DOMPurify not loaded \u2014 falling back to plain text for safety');
      return escapeHtml(text);
    }
    // Use more permissive config for code blocks with copy buttons
    var config = Object.assign({}, PURIFY_CONFIG);
    return DOMPurify.sanitize(raw, config);
  }

  function renderPlainText(text) {
    return escapeHtml(text || '');
  }

  // Copy code to clipboard
  function copyCodeToClipboard(codeId) {
    var code = codeBlocks.get(codeId);
    if (!code) return Promise.resolve(false);
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(code).then(function() { return true; });
    }
    
    // Fallback for non-secure contexts
    var textarea = document.createElement('textarea');
    textarea.value = code;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return Promise.resolve(true);
    } catch (err) {
      document.body.removeChild(textarea);
      return Promise.resolve(false);
    }
  }

  // Handle copy button clicks via event delegation
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.code-copy-btn');
    if (!btn) return;
    
    var codeId = btn.getAttribute('data-code-id');
    if (!codeId) return;
    
    copyCodeToClipboard(codeId).then(function(success) {
      if (success) {
        var originalHTML = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        btn.classList.add('copied');
        setTimeout(function() {
          btn.innerHTML = originalHTML;
          btn.classList.remove('copied');
        }, 2000);
      }
    });
  });

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
    copyCodeToClipboard: copyCodeToClipboard,
    _codeBlocks: codeBlocks,
  };
})();
