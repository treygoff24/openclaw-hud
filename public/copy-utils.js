// Copy Utils Module — shared clipboard utility for copy buttons
(function() {
  'use strict';

  // SVG icons shared across all copy buttons
  var COPY_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  var CHECK_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  function setButtonContent(btn, icon, visibleLabel) {
    btn.innerHTML = icon;
    if (!visibleLabel) return;
    var label = document.createElement('span');
    label.className = 'copy-btn-label';
    label.textContent = visibleLabel;
    btn.appendChild(label);
  }

  /**
   * Create a copy button with clipboard feedback.
   *
   * @param {string|Function} getText - The text to copy, or a zero-argument
   *   function that returns it (evaluated lazily on each click).
   * @param {string} [ariaLabel] - Button aria-label and title. Defaults to
   *   'Copy to clipboard'.
   * @param {{visibleLabel?: string, copiedLabel?: string}} [options]
   * @returns {HTMLButtonElement}
   */
  function createCopyButton(getText, ariaLabel, options) {
    var label = ariaLabel || 'Copy to clipboard';
    var opts = options || {};
    var visibleLabel = typeof opts.visibleLabel === 'string' ? opts.visibleLabel : '';
    var copiedLabel = typeof opts.copiedLabel === 'string' ? opts.copiedLabel : null;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    setButtonContent(btn, COPY_ICON, visibleLabel);

    btn.onclick = function(e) {
      e.stopPropagation();
      var text = typeof getText === 'function' ? getText() : getText;
      navigator.clipboard.writeText(text).then(function() {
        btn.classList.add('copied');
        setButtonContent(btn, CHECK_ICON, copiedLabel !== null ? copiedLabel : visibleLabel);
        btn.title = 'Copied!';
        setTimeout(function() {
          btn.classList.remove('copied');
          setButtonContent(btn, COPY_ICON, visibleLabel);
          btn.title = label;
        }, 2000);
      }).catch(function(err) {
        console.error('Failed to copy:', err);
      });
    };

    return btn;
  }

  /**
   * Build a markdown string from an assistant message content array.
   * Handles text, tool_use, and thinking block types.
   *
   * @param {Array} content - Array of content blocks from an assistant message.
   * @returns {string} Markdown representation of the content.
   */
  function buildContentBlocksMarkdown(content) {
    var markdown = '';
    if (!Array.isArray(content)) return markdown;

    content.forEach(function(block) {
      if (block.type === 'text') {
        markdown += block.text + '\n';
      } else if (block.type === 'tool_use') {
        markdown += '\n```json\n';
        markdown += 'Tool: ' + block.name + '\n';
        markdown += JSON.stringify(block.input, null, 2) + '\n';
        markdown += '```\n\n';
      } else if (block.type === 'thinking') {
        markdown += '\n> Thinking: ' + block.thinking + '\n\n';
      }
      // Other block types (image, etc.) are silently skipped.
    });

    return markdown;
  }

  window.CopyUtils = {
    COPY_ICON: COPY_ICON,
    CHECK_ICON: CHECK_ICON,
    createCopyButton: createCopyButton,
    buildContentBlocksMarkdown: buildContentBlocksMarkdown,
  };
})();
