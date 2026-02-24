const CHAT_MESSAGE_TYPES = ['chat-subscribe', 'chat-unsubscribe', 'chat-send', 'chat-history', 'chat-abort', 'chat-new', 'models-list'];

function isChatMessage(type) {
  return CHAT_MESSAGE_TYPES.includes(type);
}

async function dispatchChatMessage(msg, handlers, context) {
  const handler = handlers[msg && msg.type];
  if (!handler) return false;
  await handler(msg, context);
  return true;
}

module.exports = {
  CHAT_MESSAGE_TYPES,
  isChatMessage,
  dispatchChatMessage,
};
