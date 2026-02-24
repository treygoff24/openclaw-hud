(function() {
  'use strict';

  window.ChatCommandsModules = window.ChatCommandsModules || {};

  function executeLocal(cmd, args) {
    const state = window.ChatState;

    switch (cmd.name) {
      case 'help':
        return { handled: true, local: true, result: window.ChatCommandsModules.help.renderHelp() };

      case 'abort':
      case 'stop':
        if (state.currentSession) {
          state.sendWs({
            type: 'chat-abort',
            sessionKey: state.currentSession.sessionKey
          });
        }
        return { handled: true, local: true, result: 'Aborting current operation...' };

      case 'new': {
        const modelMatch = args.match(/^\S+/);
        const model = modelMatch ? modelMatch[0] : null;
        state.sendWs({ type: 'chat-new', model: model });
        return {
          handled: true,
          local: true,
          result: model ? 'Starting new session with ' + model + '...' : 'Starting new session...'
        };
      }

      case 'reset':
        if (state.currentSession) {
          state.sendWs({
            type: 'chat-reset',
            sessionKey: state.currentSession.sessionKey,
            options: args
          });
        }
        return { handled: true, local: true, result: 'Resetting current session...' };

      case 'clear': {
        const container = document.getElementById('chat-messages');
        if (container) {
          const empty = document.getElementById('chat-empty');
          container.innerHTML = '';
          if (empty) container.appendChild(empty);
        }
        return { handled: true, local: true, result: 'Chat cleared' };
      }

      case 'model':
        if (args) {
          state.sendWs({ type: 'chat-model', model: args });
          return { handled: true, local: true, result: 'Setting model to ' + args + '...' };
        }

        return {
          handled: true,
          local: true,
          result: 'Current model: ' + (document.getElementById('sys-model')?.textContent || 'unknown')
        };

      case 'think': {
        const level = args.trim() || 'on';
        state.sendWs({ type: 'chat-think', value: level });
        return { handled: true, local: true, result: 'Setting thinking to ' + level + '...' };
      }

      case 'verbose': {
        const verboseMode = args.trim() || 'on';
        state.sendWs({ type: 'chat-verbose', value: verboseMode });
        return { handled: true, local: true, result: 'Setting verbose to ' + verboseMode + '...' };
      }

      case 'status': {
        const uptime = document.getElementById('stat-uptime')?.textContent || '—';
        const agents = document.getElementById('stat-agents')?.textContent || '—';
        const active = document.getElementById('stat-active')?.textContent || '—';
        const session = state.currentSession?.sessionKey || 'none';

        const statusText = [
          '═══ SYSTEM STATUS ═══',
          'Uptime: ' + uptime,
          'Agents: ' + agents,
          'Active: ' + active,
          'Session: ' + session,
          '═══════════════════'
        ].join('\n');

        return { handled: true, local: true, result: statusText };
      }

      case 'models':
        state.sendWs({ type: 'models-list', provider: args || undefined });
        return { handled: true, local: true, result: 'Fetching available models...' };

      default:
        return { handled: false, local: false, command: cmd, args: args };
    }
  }

  window.ChatCommandsModules.localExec = {
    executeLocal: executeLocal
  };
})();
