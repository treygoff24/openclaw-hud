// Chat Commands Module — slash command registry and execution
(function() {
  'use strict';

  // ============================================
  // Command Definitions
  // ============================================
  
  const CATEGORIES = {
    SESSION: 'Session',
    MODEL: 'Model',
    DISPLAY: 'Display',
    TOOLS: 'Tools',
    MEMORY: 'Memory',
    SYSTEM: 'System',
    CONFIG: 'Config'
  };

  // Command registry with all supported slash commands
  const commands = [
    // Session commands
    {
      name: 'help',
      aliases: ['h', 'commands', 'cmds'],
      description: 'Show available commands and their usage',
      category: CATEGORIES.SESSION,
      local: true,
      args: []
    },
    {
      name: 'abort',
      aliases: ['stop', 'cancel'],
      description: 'Cancel the current operation',
      category: CATEGORIES.SESSION,
      local: true,
      args: []
    },
    {
      name: 'new',
      aliases: ['n', 'start'],
      description: 'Start a new session',
      category: CATEGORIES.SESSION,
      local: true,
      args: [
        { name: 'model', description: 'Model to use for new session', required: false }
      ]
    },
    {
      name: 'reset',
      aliases: ['r', 'clear-session'],
      description: 'Reset the current session',
      category: CATEGORIES.SESSION,
      local: true,
      args: [
        { name: 'options', description: 'Reset options', required: false }
      ]
    },
    {
      name: 'clear',
      aliases: ['cls', 'clr'],
      description: 'Clear the chat display',
      category: CATEGORIES.DISPLAY,
      local: true,
      args: []
    },
    {
      name: 'export',
      aliases: ['save-session', 'backup'],
      description: 'Export current session to HTML file',
      category: CATEGORIES.SESSION,
      local: false,
      args: [
        { name: 'path', description: 'Output path (default: workspace)', required: false, default: '' }
      ]
    },
    {
      name: 'session',
      aliases: ['sesh'],
      description: 'Manage session settings (e.g., /session ttl 24h)',
      category: CATEGORIES.SESSION,
      local: false,
      args: [
        { name: 'action', description: 'ttl or other action', required: true },
        { name: 'value', description: 'Duration or value', required: false }
      ]
    },
    {
      name: 'save',
      aliases: [],
      description: 'Save the current state',
      category: CATEGORIES.SESSION,
      local: false,
      args: [
        { name: 'name', description: 'Save name', required: false }
      ]
    },
    {
      name: 'load',
      aliases: [],
      description: 'Load a saved state',
      category: CATEGORIES.SESSION,
      local: false,
      args: [
        { name: 'name', description: 'Save name to load', required: true }
      ]
    },
    {
      name: 'continue',
      aliases: ['cont', 'c'],
      description: 'Continue from previous response',
      category: CATEGORIES.SESSION,
      local: false,
      args: []
    },
    {
      name: 'retry',
      aliases: ['again', 're'],
      description: 'Retry the last message',
      category: CATEGORIES.SESSION,
      local: false,
      args: []
    },

    // Model commands
    {
      name: 'model',
      aliases: ['m', 'mdl'],
      description: 'Show or set the active model',
      category: CATEGORIES.MODEL,
      local: true,
      args: [
        { name: 'name', description: 'Model ID (provider/model or shorthand)', required: false }
      ]
    },
    {
      name: 'models',
      aliases: ['list-models', 'modellist'],
      description: 'List available models',
      category: CATEGORIES.MODEL,
      local: true,
      args: [
        { name: 'provider', description: 'Filter by provider', required: false }
      ]
    },
    {
      name: 'provider',
      aliases: ['prov'],
      description: 'Set or show the model provider',
      category: CATEGORIES.MODEL,
      local: false,
      args: [
        { name: 'name', description: 'Provider name', required: false }
      ]
    },
    {
      name: 'temp',
      aliases: ['temperature'],
      description: 'Set temperature (0-2)',
      category: CATEGORIES.MODEL,
      local: false,
      args: [
        { name: 'value', description: 'Temperature value (0.0-2.0)', required: true }
      ]
    },
    {
      name: 'max-tokens',
      aliases: ['maxtokens', 'tokens'],
      description: 'Set maximum tokens for responses',
      category: CATEGORIES.MODEL,
      local: false,
      args: [
        { name: 'count', description: 'Maximum token count', required: true }
      ]
    },

    // Display/Thinking commands
    {
      name: 'think',
      aliases: ['thinking', 't'],
      description: 'Toggle or set thinking level (on/off/minimal/low/medium/high/xhigh)',
      category: CATEGORIES.DISPLAY,
      local: true,
      args: [
        { name: 'level', description: 'Thinking level', required: false, 
          choices: ['on', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'] }
      ]
    },
    {
      name: 'think-depth',
      aliases: ['depth'],
      description: 'Set thinking depth level',
      category: CATEGORIES.DISPLAY,
      local: false,
      args: [
        { name: 'level', description: 'Depth level (1-5)', required: true }
      ]
    },
    {
      name: 'verbose',
      aliases: ['v', 'verbosity'],
      description: 'Toggle verbose mode (on/off)',
      category: CATEGORIES.DISPLAY,
      local: true,
      args: [
        { name: 'mode', description: 'on or off', required: false, 
          choices: ['on', 'off'] }
      ]
    },
    {
      name: 'reasoning',
      aliases: ['reason', 'show-reasoning'],
      description: 'Toggle reasoning visibility (on/off/stream)',
      category: CATEGORIES.DISPLAY,
      local: false,
      args: [
        { name: 'mode', description: 'on, off, or stream', required: false,
          choices: ['on', 'off', 'stream'] }
      ]
    },
    {
      name: 'status',
      aliases: ['stat', 'info'],
      description: 'Show current session and system status',
      category: CATEGORIES.SYSTEM,
      local: true,
      args: []
    },
    {
      name: 'output',
      aliases: ['out'],
      description: 'Configure output format',
      category: CATEGORIES.DISPLAY,
      local: false,
      args: [
        { name: 'format', description: 'Output format', required: false }
      ]
    },
    {
      name: 'response',
      aliases: ['resp'],
      description: 'Configure response settings',
      category: CATEGORIES.DISPLAY,
      local: false,
      args: [
        { name: 'setting', description: 'Setting name', required: true },
        { name: 'value', description: 'Setting value', required: false }
      ]
    },

    // Tools/Search commands
    {
      name: 'search',
      aliases: ['find', 'lookup'],
      description: 'Search the web',
      category: CATEGORIES.TOOLS,
      local: false,
      args: [
        { name: 'query', description: 'Search query', required: true, captureRemaining: true }
      ]
    },
    {
      name: 'web',
      aliases: ['fetch', 'url', 'page'],
      description: 'Fetch and read a webpage',
      category: CATEGORIES.TOOLS,
      local: false,
      args: [
        { name: 'url', description: 'URL to fetch', required: true },
        { name: 'options', description: 'Fetch options', required: false }
      ]
    },
    {
      name: 'edit',
      aliases: ['modify', 'change'],
      description: 'Edit a file',
      category: CATEGORIES.TOOLS,
      local: false,
      args: [
        { name: 'path', description: 'File path', required: true },
        { name: 'instruction', description: 'Edit instruction', required: true, captureRemaining: true }
      ]
    },
    {
      name: 'max-turns',
      aliases: ['turns'],
      description: 'Set maximum conversation turns',
      category: CATEGORIES.TOOLS,
      local: false,
      args: [
        { name: 'count', description: 'Maximum number of turns', required: true }
      ]
    },

    // Memory commands
    {
      name: 'recall',
      aliases: ['remember', 'mem'],
      description: 'Recall information from memory',
      category: CATEGORIES.MEMORY,
      local: false,
      args: [
        { name: 'key', description: 'Memory key or query', required: false }
      ]
    },
    {
      name: 'memory',
      aliases: ['memories', 'notes'],
      description: 'Manage memory entries',
      category: CATEGORIES.MEMORY,
      local: false,
      args: [
        { name: 'action', description: 'add, remove, list, or search', required: false,
          choices: ['add', 'remove', 'list', 'search'] },
        { name: 'content', description: 'Memory content or query', required: false, captureRemaining: true }
      ]
    },
    {
      name: 'alias',
      aliases: ['shortcut', 'aka'],
      description: 'Create a command alias',
      category: CATEGORIES.MEMORY,
      local: false,
      args: [
        { name: 'name', description: 'Alias name', required: true },
        { name: 'command', description: 'Command to alias', required: true, captureRemaining: true }
      ]
    },
    {
      name: 'context',
      aliases: ['ctx'],
      description: 'Manage context files or explain context usage',
      category: CATEGORIES.MEMORY,
      local: false,
      args: [
        { name: 'action', description: 'add, remove, list, or explain', required: false },
        { name: 'path', description: 'File path', required: false }
      ]
    },

    // System/Config commands
    {
      name: 'prompt',
      aliases: ['system-prompt', 'sysprompt'],
      description: 'Set or view the system prompt',
      category: CATEGORIES.CONFIG,
      local: false,
      args: [
        { name: 'text', description: 'System prompt text', required: false, captureRemaining: true }
      ]
    },
    {
      name: 'system',
      aliases: ['sys', 'settings'],
      description: 'Show or modify system settings',
      category: CATEGORIES.SYSTEM,
      local: false,
      args: [
        { name: 'setting', description: 'Setting name', required: false },
        { name: 'value', description: 'Setting value', required: false, captureRemaining: true }
      ]
    }
  ];

  // ============================================
  // Levenshtein Distance for Fuzzy Matching
  // ============================================
  
  function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    
    return matrix[b.length][a.length];
  }

  function getFuzzyScore(input, target) {
    input = input.toLowerCase();
    target = target.toLowerCase();
    
    // Exact match
    if (target === input) return 1.0;
    
    // Starts with
    if (target.startsWith(input)) return 0.9;
    
    // Contains
    if (target.includes(input)) return 0.7;
    
    // Levenshtein similarity
    const maxLen = Math.max(input.length, target.length);
    if (maxLen === 0) return 0;
    const distance = levenshteinDistance(input, target);
    const similarity = 1 - (distance / maxLen);
    
    return similarity > 0.5 ? similarity * 0.6 : 0;
  }

  // ============================================
  // Command Registry API
  // ============================================

  function getAll() {
    return commands.slice();
  }

  function find(input) {
    if (!input || input.length < 1) return null;
    
    input = input.toLowerCase().replace(/^\//, '');
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const cmd of commands) {
      // Match by name
      let score = getFuzzyScore(input, cmd.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = cmd;
      }
      
      // Match by aliases
      for (const alias of cmd.aliases) {
        score = getFuzzyScore(input, alias);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = cmd;
        }
      }
    }
    
    // Lower threshold for short inputs to catch typos
    const threshold = input.length <= 4 ? 0.5 : 0.6;
    return bestScore > threshold ? bestMatch : null;
  }

  function search(input) {
    if (!input || input.length < 1) return getAll();
    
    input = input.toLowerCase().replace(/^\//, '');
    
    const results = [];
    for (const cmd of commands) {
      let maxScore = 0;
      
      // Score name
      maxScore = Math.max(maxScore, getFuzzyScore(input, cmd.name));
      
      // Score aliases
      for (const alias of cmd.aliases) {
        maxScore = Math.max(maxScore, getFuzzyScore(input, alias));
      }
      
      // Score description
      const descWords = cmd.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.includes(input)) {
          maxScore = Math.max(maxScore, 0.3);
        }
      }
      
      if (maxScore > 0.5) {
        results.push({ command: cmd, score: maxScore });
      }
    }
    
    results.sort((a, b) => b.score - a.score);
    return results.map(r => r.command);
  }

  function parse(input) {
    if (!input || !input.startsWith('/')) {
      return { isCommand: false, command: null, args: '' };
    }
    
    const trimmed = input.slice(1).trim();
    const firstSpace = trimmed.indexOf(' ');
    
    let command, args;
    if (firstSpace === -1) {
      command = trimmed;
      args = '';
    } else {
      command = trimmed.substring(0, firstSpace);
      args = trimmed.substring(firstSpace + 1).trim();
    }
    
    return { isCommand: true, command: command, args: args, original: input };
  }

  // ============================================
  // Command Execution
  // ============================================

  function execute(input) {
    const parsed = parse(input);
    
    if (!parsed.isCommand) {
      return { handled: false, local: false, result: null };
    }
    
    const cmd = find(parsed.command);
    
    if (!cmd) {
      return { handled: false, local: false, result: null, error: 'Unknown command' };
    }
    
    // Execute local commands
    if (cmd.local) {
      return executeLocal(cmd, parsed.args);
    }
    
    // Non-local commands return not-handled so they can be sent to server
    return { handled: false, local: false, command: cmd, args: parsed.args };
  }

  function executeLocal(cmd, args) {
    const state = window.ChatState;
    
    switch (cmd.name) {
      case 'help':
        return { handled: true, local: true, result: renderHelp() };
        
      case 'abort':
      case 'stop':
        if (state.currentSession) {
          state.sendWs({ 
            type: 'chat-abort', 
            sessionKey: state.currentSession.sessionKey 
          });
        }
        return { handled: true, local: true, result: 'Aborting current operation...' };
        
      case 'new':
        const modelMatch = args.match(/^\S+/);
        const model = modelMatch ? modelMatch[0] : null;
        state.sendWs({ type: 'chat-new', model: model });
        return { handled: true, local: true, result: model ? `Starting new session with ${model}...` : 'Starting new session...' };
        
      case 'reset':
        if (state.currentSession) {
          state.sendWs({ 
            type: 'chat-reset', 
            sessionKey: state.currentSession.sessionKey,
            options: args
          });
        }
        return { handled: true, local: true, result: 'Resetting current session...' };
        
      case 'clear':
        const container = document.getElementById('chat-messages');
        if (container) {
          const empty = document.getElementById('chat-empty');
          container.innerHTML = '';
          if (empty) container.appendChild(empty);
        }
        return { handled: true, local: true, result: 'Chat cleared' };
        
      case 'model':
        if (args) {
          state.sendWs({ type: 'chat-model', model: args });
          return { handled: true, local: true, result: `Setting model to ${args}...` };
        } else {
          // Just show current model
          const currentModel = document.getElementById('sys-model')?.textContent || 'unknown';
          return { handled: true, local: true, result: `Current model: ${currentModel}` };
        }
        
      case 'think':
        const level = args.trim() || 'on';
        state.sendWs({ type: 'chat-think', value: level });
        return { handled: true, local: true, result: `Setting thinking to ${level}...` };
        
      case 'verbose':
        const verboseMode = args.trim() || 'on';
        state.sendWs({ type: 'chat-verbose', value: verboseMode });
        return { handled: true, local: true, result: `Setting verbose to ${verboseMode}...` };
        
      case 'status':
        const uptime = document.getElementById('stat-uptime')?.textContent || '—';
        const agents = document.getElementById('stat-agents')?.textContent || '—';
        const active = document.getElementById('stat-active')?.textContent || '—';
        const session = state.currentSession?.sessionKey || 'none';
        
        const statusText = [
          '═══ SYSTEM STATUS ═══',
          `Uptime: ${uptime}`,
          `Agents: ${agents}`,
          `Active: ${active}`,
          `Session: ${session}`,
          '═══════════════════'
        ].join('\n');
        
        return { handled: true, local: true, result: statusText };
        
      case 'models':
        state.sendWs({ type: 'models-list', provider: args || undefined });
        return { handled: true, local: true, result: 'Fetching available models...' };
        
      default:
        return { handled: false, local: false, command: cmd, args: args };
    }
  }

  // ============================================
  // Help Rendering
  // ============================================

  function renderHelp() {
    const byCategory = {};
    
    for (const cmd of commands) {
      if (!byCategory[cmd.category]) {
        byCategory[cmd.category] = [];
      }
      byCategory[cmd.category].push(cmd);
    }
    
    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                    SLASH COMMAND REFERENCE                     ║',
      '╠══════════════════════════════════════════════════════════════╣',
      ''
    ];
    
    const categoryOrder = [CATEGORIES.SESSION, CATEGORIES.MODEL, CATEGORIES.DISPLAY, CATEGORIES.TOOLS, CATEGORIES.MEMORY, CATEGORIES.SYSTEM, CATEGORIES.CONFIG];
    
    for (const cat of categoryOrder) {
      if (!byCategory[cat]) continue;
      
      lines.push(`┌─ ${cat} ─${'─'.repeat(60 - cat.length)}┐`);
      lines.push('');
      
      for (const cmd of byCategory[cat]) {
        const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : '';
        lines.push(`  /${cmd.name}${aliases}`);
        lines.push(`      ${cmd.description}`);
        
        if (cmd.args && cmd.args.length > 0) {
          for (const arg of cmd.args) {
            const required = arg.required ? '*' : '';
            const defaultVal = arg.default ? ` [default: ${arg.default}]` : '';
            const choices = arg.choices ? ` [${arg.choices.join('|')}]` : '';
            lines.push(`      <${arg.name}${required}>${choices}${defaultVal}: ${arg.description}`);
          }
        }
        lines.push('');
      }
    }
    
    lines.push('└──────────────────────────────────────────────────────────────┘');
    lines.push('');
    lines.push('Tips:');
    lines.push('  • Use Tab to autocomplete commands');
    lines.push('  • Commands marked with * are handled locally');
    lines.push('  • Use /help <command> for detailed help on a specific command');
    
    return lines.join('\n');
  }

  // ============================================
  // Public API
  // ============================================

  window.ChatCommands = {
    getAll: getAll,
    find: find,
    search: search,
    parse: parse,
    execute: execute,
    renderHelp: renderHelp,
    // Expose for testing
    _levenshtein: levenshteinDistance,
    _getFuzzyScore: getFuzzyScore
  };
})();
