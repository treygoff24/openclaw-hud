(function() {
  'use strict';
  var runtime = window.ChatPaneRuntime || (window.ChatPaneRuntime = {});

  runtime.constants = {
    CHAT_LOG_PREFIX: '[HUD-CHAT]',
    HISTORY_LOAD_TIMEOUT_MS: 10000,
    CANONICAL_SESSION_KEY_RE: /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9:_-]+$/,
    MAX_CACHED_MESSAGES: 500,
    DEDUP_RECENT_WINDOW: 10,
  };
})();
