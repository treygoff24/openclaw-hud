// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const facadeSource = fs.readFileSync(path.resolve(process.cwd(), "public/chat-pane.js"), "utf8");

describe("chat-pane facade runtime guard", () => {
  beforeEach(() => {
    delete window.openChatPane;
    delete window.closeChatPane;
    delete window.restoreSavedChatSession;
    delete window.handleChatWsMessage;
    delete window._flushChatWsQueue;
    delete window.exportChatSession;
    delete window.ChatState;
    delete window.ChatPaneRuntime;
  });

  it("throws when ChatPaneRuntime is missing", () => {
    expect(() => window.eval(facadeSource)).toThrow(
      "ChatPaneRuntime is missing. Ensure chat-pane modules load before chat-pane.js.",
    );
  });

  it("throws when ChatPaneRuntime is missing required members", () => {
    window.ChatPaneRuntime = { openChatPane: () => {} };
    expect(() => window.eval(facadeSource)).toThrow(
      "ChatPaneRuntime missing required API: closeChatPane",
    );
  });

  it("binds global APIs when runtime is complete", () => {
    const openChatPane = () => {};
    const closeChatPane = () => {};
    const restoreSavedChatSession = () => {};
    const handleChatWsMessage = () => {};
    const flushWsQueue = () => {};
    const exportChatSession = () => {};
    const ChatState = { currentSession: null };

    window.ChatPaneRuntime = {
      openChatPane,
      closeChatPane,
      restoreSavedChatSession,
      handleChatWsMessage,
      flushWsQueue,
      exportChatSession,
      ChatState,
    };

    window.eval(facadeSource);

    expect(window.openChatPane).toBe(openChatPane);
    expect(window.closeChatPane).toBe(closeChatPane);
    expect(window.restoreSavedChatSession).toBe(restoreSavedChatSession);
    expect(window.handleChatWsMessage).toBe(handleChatWsMessage);
    expect(window._flushChatWsQueue).toBe(flushWsQueue);
    expect(window.exportChatSession).toBe(exportChatSession);
    expect(window.ChatState).toBe(ChatState);
  });
});
