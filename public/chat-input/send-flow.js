(function () {
  "use strict";

  function sendMessage(options) {
    const state = window.ChatState;
    if (!state.currentSession) return;

    const input = document.getElementById("chat-input");
    if (!input) return;

    const text = input.value.trim();
    const attachments = options.getAttachments();

    if (!text && attachments.length === 0) return;

    if (text.startsWith("/")) {
      const result = window.ChatCommands ? window.ChatCommands.execute(text) : null;

      if (result && result.handled && result.local) {
        showCommandResult(result.result);
        input.value = "";
        input.style.height = "auto";
        options.removeAutocomplete();
        options.removeArgumentHints();
        return;
      }
    }

    const idempotencyKey = crypto.randomUUID();
    const div = document.createElement("div");
    div.className = "chat-msg user pending";
    const roleSpan = document.createElement("span");
    roleSpan.className = "chat-msg-role user";
    roleSpan.textContent = "user";
    div.appendChild(roleSpan);
    const contentDiv = document.createElement("div");
    contentDiv.className = "chat-msg-content";
    contentDiv.textContent = text;
    div.appendChild(contentDiv);

    if (attachments.length > 0) {
      const imagesDiv = document.createElement("div");
      imagesDiv.className = "chat-msg-images";
      attachments.forEach(function (att) {
        const img = document.createElement("img");
        img.src = "data:" + att.source.media_type + ";base64," + att.source.data;
        img.className = "chat-msg-image";
        imagesDiv.appendChild(img);
      });
      div.appendChild(imagesDiv);
    }

    const container = document.getElementById("chat-messages");
    if (container) container.appendChild(div);

    state.pendingAcks.set(idempotencyKey, { el: div, message: text });
    input.value = "";
    input.style.height = "auto";
    input.disabled = true;

    options.removeAutocomplete();
    options.removeArgumentHints();

    const wsMessage = {
      type: "chat-send",
      sessionKey: state.currentSession.sessionKey,
      message: text,
      idempotencyKey: idempotencyKey,
    };
    if (attachments.length > 0) {
      wsMessage.attachments = attachments;
    }
    window.ChatState.sendWs(wsMessage);

    options.clearSentAttachments();
  }

  function showCommandResult(result) {
    if (!result) return;

    const container = document.getElementById("chat-messages");
    if (!container) return;

    const div = document.createElement("div");
    div.className = "chat-msg system";

    const roleSpan = document.createElement("span");
    roleSpan.className = "chat-msg-role system";
    roleSpan.textContent = "system";
    div.appendChild(roleSpan);

    const contentDiv = document.createElement("div");
    contentDiv.className = "chat-msg-content";

    const pre = document.createElement("pre");
    pre.className = "command-output";
    pre.textContent = result;
    contentDiv.appendChild(pre);

    div.appendChild(contentDiv);

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  window.ChatInputSendFlow = {
    sendMessage: sendMessage,
    showCommandResult: showCommandResult,
  };
})();
