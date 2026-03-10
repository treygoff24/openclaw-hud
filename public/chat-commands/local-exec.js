(function () {
  "use strict";

  window.ChatCommandsModules = window.ChatCommandsModules || {};

  function getActiveSession(state) {
    if (!state.currentSession || !state.currentSession.sessionKey) return null;
    return state.currentSession;
  }

  function noActiveSessionResult() {
    return { handled: true, local: true, result: "No active session. Start one with /new." };
  }

  function executeLocal(cmd, args) {
    const state = window.ChatState;

    switch (cmd.name) {
      case "help":
        return { handled: true, local: true, result: window.ChatCommandsModules.help.renderHelp() };

      case "abort":
      case "stop":
        if (state.currentSession) {
          state.sendWs({
            type: "chat-abort",
            sessionKey: state.currentSession.sessionKey,
          });
        }
        return { handled: true, local: true, result: "Aborting current operation..." };

      case "new": {
        const modelMatch = args.match(/^\S+/);
        const model = modelMatch ? modelMatch[0] : null;
        state.sendWs({ type: "chat-new", model: model });
        return {
          handled: true,
          local: true,
          result: model ? "Starting new session with " + model + "..." : "Starting new session...",
        };
      }

      case "reset":
        if (!getActiveSession(state)) return noActiveSessionResult();
        {
          const modelMatch = args.match(/^\S+/);
          const model = modelMatch ? modelMatch[0] : null;
          state.sendWs({ type: "chat-new", model: model });
        }
        return { handled: true, local: true, result: "Resetting current session..." };

      case "clear": {
        const container = document.getElementById("chat-messages");
        if (container) {
          const empty = document.getElementById("chat-empty");
          container.innerHTML = "";
          if (empty) container.appendChild(empty);
        }
        return { handled: true, local: true, result: "Chat cleared" };
      }

      case "model":
        if (args) {
          const activeSession = getActiveSession(state);
          if (!activeSession) return noActiveSessionResult();
          state.sendWs({
            type: "sessions.patch",
            sessionKey: activeSession.sessionKey,
            model: args,
          });
          return { handled: true, local: true, result: "Setting model to " + args + "..." };
        }

        return {
          handled: true,
          local: true,
          result:
            "Current model: " + (document.getElementById("sys-model")?.textContent || "unknown"),
        };

      case "think": {
        const activeSession = getActiveSession(state);
        if (!activeSession) return noActiveSessionResult();
        const level = (args.trim() || "on").toLowerCase();
        if (!["on", "off", "extended"].includes(level)) {
          return {
            handled: true,
            local: true,
            result: "Invalid thinking mode. Use on, off, or extended.",
          };
        }
        state.sendWs({
          type: "sessions.patch",
          sessionKey: activeSession.sessionKey,
          thinking: level,
        });
        return { handled: true, local: true, result: "Setting thinking to " + level + "..." };
      }

      case "verbose": {
        const activeSession = getActiveSession(state);
        if (!activeSession) return noActiveSessionResult();
        const verboseInput = (args.trim() || "on").toLowerCase();
        if (!["on", "off"].includes(verboseInput)) {
          return { handled: true, local: true, result: "Invalid verbose mode. Use on or off." };
        }
        const verboseValue = verboseInput === "on";
        state.sendWs({
          type: "sessions.patch",
          sessionKey: activeSession.sessionKey,
          verbose: verboseValue,
        });
        return {
          handled: true,
          local: true,
          result: "Setting verbose to " + verboseInput + "...",
        };
      }

      case "status": {
        const uptime = document.getElementById("stat-uptime")?.textContent || "—";
        const agents = document.getElementById("stat-agents")?.textContent || "—";
        const active = document.getElementById("stat-active")?.textContent || "—";
        const session = state.currentSession?.sessionKey || "none";

        const statusText = [
          "═══ SYSTEM STATUS ═══",
          "Uptime: " + uptime,
          "Agents: " + agents,
          "Active: " + active,
          "Session: " + session,
          "═══════════════════",
        ].join("\n");

        return { handled: true, local: true, result: statusText };
      }

      case "models":
        state.sendWs({ type: "models-list", provider: args || undefined });
        return { handled: true, local: true, result: "Fetching available models..." };

      default:
        return { handled: false, local: false, command: cmd, args: args };
    }
  }

  window.ChatCommandsModules.localExec = {
    executeLocal: executeLocal,
  };
})();
