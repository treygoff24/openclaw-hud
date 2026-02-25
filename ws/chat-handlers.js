const { handleChatMessage, isChatMessage } = require("./chat-handlers/command-handlers");
const {
  setupChatEventRouting,
  cleanupChatSubscriptions,
} = require("./chat-handlers/subscriptions");
const { chatSubscriptions, clientChatSubs } = require("./chat-handlers/state");
const {
  checkAttachmentRateLimit,
  MAX_ATTACHMENTS_PER_MINUTE,
  RATE_LIMIT_WINDOW_MS,
  connectionAttachmentTimestamps,
} = require("./chat-handlers/attachments");

module.exports = {
  handleChatMessage,
  isChatMessage,
  setupChatEventRouting,
  cleanupChatSubscriptions,
  chatSubscriptions,
  clientChatSubs,
  // Rate limiting exports for testing
  checkAttachmentRateLimit,
  MAX_ATTACHMENTS_PER_MINUTE,
  RATE_LIMIT_WINDOW_MS,
  connectionAttachmentTimestamps,
};
