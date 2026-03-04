(function () {
  "use strict";

  var THRESHOLD = 50;
  var _userScrolledUp = false;
  var _container = null;
  var _pill = null;
  var _listening = false;
  var scrollQueued = false;

  function isAtBottom() {
    if (!_container) return true;
    return _container.scrollHeight - _container.scrollTop - _container.clientHeight < THRESHOLD;
  }

  function scheduleAutoScroll(container, force) {
    if (scrollQueued) return;
    if (!force && !isAtBottom()) return;
    scrollQueued = true;
    requestAnimationFrame(function () {
      container.scrollTop = container.scrollHeight;
      scrollQueued = false;
      if (_pill) _pill.classList.remove("visible");
    });
  }

  function onScroll() {
    if (isAtBottom()) {
      _userScrolledUp = false;
      if (_pill) _pill.classList.remove("visible");
    } else {
      _userScrolledUp = true;
    }
  }

  function init() {
    _container = document.getElementById("chat-messages");
    _pill = document.getElementById("chat-new-pill");
    _userScrolledUp = false;
    if (_pill) _pill.classList.remove("visible");

    if (_container && !_listening) {
      _container.addEventListener("scroll", onScroll, { passive: true });
      _listening = true;
    }
  }

  function scrollToBottom(force) {
    if (!_container) _container = document.getElementById("chat-messages");
    if (!_container) return;

    if (force || !_userScrolledUp) {
      scheduleAutoScroll(_container, force);
      _userScrolledUp = false;
      if (_pill) _pill.classList.remove("visible");
    } else {
      if (_pill) _pill.classList.add("visible");
    }
  }

  function reset() {
    _userScrolledUp = false;
    if (_pill) _pill.classList.remove("visible");
  }

  window.ChatScroll = {
    init: init,
    scrollToBottom: scrollToBottom,
    reset: reset,
  };
})();
