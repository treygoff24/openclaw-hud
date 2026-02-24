// Chat Input Module — controller/wiring for chat input modules
(function() {
  'use strict';

  const attachments = window.ChatInputAttachments;
  const autocomplete = window.ChatInputAutocomplete;
  const sendFlow = window.ChatInputSendFlow;
  const modelPicker = window.ChatInputModelPicker;

  if (!attachments || !autocomplete || !sendFlow || !modelPicker) {
    throw new Error('chat-input modules missing. Load /chat-input/*.js before /chat-input.js');
  }

  function sendMessage() {
    sendFlow.sendMessage({
      getAttachments: attachments.getAttachments,
      clearSentAttachments: attachments.clearSentAttachments,
      removeAutocomplete: autocomplete.removeAutocomplete,
      removeArgumentHints: autocomplete.removeArgumentHints
    });
  }

  function renderModelPicker(models) {
    modelPicker.renderModelPicker(models);
  }

  function handleKeyDown(e) {
    if (e.target.id !== 'chat-input') return;

    if (autocomplete.isAutocompleteOpen()) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          autocomplete.navigateDown();
          return;
        case 'ArrowUp':
          e.preventDefault();
          autocomplete.navigateUp();
          return;
        case 'Tab':
          e.preventDefault();
          if (autocomplete.completeSelected()) {
            return;
          }
          break;
        case 'Enter':
          if (!e.shiftKey) {
            if (autocomplete.completeSelected()) {
              e.preventDefault();
              return;
            }
            autocomplete.removeAutocomplete();
            autocomplete.removeArgumentHints();
          }
          break;
        case 'Escape':
          e.preventDefault();
          autocomplete.removeAutocomplete();
          return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInput(e) {
    if (e.target.id !== 'chat-input') return;

    const input = e.target;
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    input.style.overflowY = input.scrollHeight > 160 ? 'auto' : 'hidden';

    autocomplete.updateAutocomplete(input);
  }

  function handleClick(e) {
    if (e.target.id === 'chat-send-btn') {
      sendMessage();
    } else if (e.target.id === 'chat-stop-btn') {
      const state = window.ChatState;
      if (state.currentSession) {
        state.sendWs({ type: 'chat-abort', sessionKey: state.currentSession.sessionKey });
      }
    } else if (e.target.id === 'chat-new-btn') {
      const state = window.ChatState;
      if (state.cachedModels) {
        renderModelPicker(state.cachedModels);
      } else {
        state.sendWs({ type: 'models-list' });
      }
    }
  }

  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('input', handleInput);
  document.addEventListener('click', handleClick);

  document.addEventListener('click', function(e) {
    if (!autocomplete.isAutocompleteOpen()) return;
    if (!e.target.closest('#chat-input') && !e.target.closest('#slash-autocomplete')) {
      autocomplete.removeAutocomplete();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachments.initAttachments);
  } else {
    attachments.initAttachments();
  }

  window.ChatInput = {
    sendMessage: sendMessage,
    renderModelPicker: renderModelPicker,
    _showCommandResult: sendFlow.showCommandResult,
    _removeAutocomplete: autocomplete.removeAutocomplete,
    _removeArgumentHints: autocomplete.removeArgumentHints,
    _initAttachments: attachments.initAttachments,
    _validateFile: attachments.validateFile,
    _pendingAttachments: attachments.pendingAttachments,
    _addAttachment: attachments.addAttachment,
    _removeAttachment: attachments.removeAttachment,
    _createPreviewElement: attachments.createPreviewElement,
    _fileToBase64: attachments.fileToBase64,
    _clearAttachments: attachments.clearAttachments,
    _getAttachments: attachments.getAttachments
  };
})();
