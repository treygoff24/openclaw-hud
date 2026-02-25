const { chatSubscriptions, clientChatSubs } = require("./state");

function setupChatEventRouting(gatewayWS) {
  if (!gatewayWS) return;
  gatewayWS.on("chat-event", (payload) => {
    const { sessionKey } = payload;
    const clients = chatSubscriptions.get(sessionKey);
    if (!clients) return;
    const msg = JSON.stringify({ type: "chat-event", payload });
    for (const client of clients) {
      if (client.readyState === 1) client.send(msg);
    }
  });
}

function cleanupChatSubscriptions(ws) {
  const chatSubs = clientChatSubs.get(ws);
  if (chatSubs) {
    for (const key of chatSubs) {
      chatSubscriptions.get(key)?.delete(ws);
    }
    clientChatSubs.delete(ws);
  }
}

module.exports = {
  setupChatEventRouting,
  cleanupChatSubscriptions,
};
