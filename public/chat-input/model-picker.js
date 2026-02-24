(function() {
  'use strict';

  function renderModelPicker(models) {
    const existing = document.querySelector('.model-picker');
    if (existing) existing.remove();
    if (!models || !models.length) return;

    const picker = document.createElement('div');
    picker.className = 'model-picker';

    models.forEach(function(m) {
      const item = document.createElement('div');
      item.className = 'model-picker-item';
      item.textContent = m;
      item.onclick = function() {
        window.ChatState.sendWs({ type: 'chat-new', model: m });
        picker.remove();
      };
      picker.appendChild(item);
    });

    const header = document.querySelector('.chat-header');
    if (header) {
      header.style.position = 'relative';
      header.appendChild(picker);
    }
  }

  window.ChatInputModelPicker = {
    renderModelPicker: renderModelPicker
  };
})();
