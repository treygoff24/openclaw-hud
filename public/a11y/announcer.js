// A11y Announce Module — Screen reader announcements via ARIA live regions
(function () {
  "use strict";

  /**
   * Announcer class — manages ARIA live regions for screen reader announcements
   */
  function Announcer() {
    this.politeRegion = null;
    this.assertiveRegion = null;
    this.debounceTimers = new Map();
    this.init();
  }

  /**
   * Initialize live regions
   */
  Announcer.prototype.init = function () {
    // Create polite region (for non-urgent announcements)
    this.politeRegion = document.createElement("div");
    this.politeRegion.setAttribute("aria-live", "polite");
    this.politeRegion.setAttribute("aria-atomic", "true");
    this.politeRegion.setAttribute("class", "sr-only");
    this.politeRegion.style.cssText =
      "position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;";

    // Create assertive region (for urgent announcements)
    this.assertiveRegion = document.createElement("div");
    this.assertiveRegion.setAttribute("aria-live", "assertive");
    this.assertiveRegion.setAttribute("aria-atomic", "true");
    this.assertiveRegion.setAttribute("class", "sr-only");
    this.assertiveRegion.style.cssText =
      "position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;";

    // Append to document
    if (document.body) {
      document.body.appendChild(this.politeRegion);
      document.body.appendChild(this.assertiveRegion);
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        function () {
          document.body.appendChild(this.politeRegion);
          document.body.appendChild(this.assertiveRegion);
        }.bind(this),
      );
    }
  };

  /**
   * Announce a message politely (non-interrupting)
   * @param {string} message
   * @param {string} debounceKey — Optional key for debouncing repeated messages
   * @param {number} debounceMs — Debounce delay in ms (default: 100)
   */
  Announcer.prototype.announce = function (message, debounceKey, debounceMs) {
    debounceMs = debounceMs || 100;

    if (debounceKey) {
      // Clear existing timer for this key
      if (this.debounceTimers.has(debounceKey)) {
        clearTimeout(this.debounceTimers.get(debounceKey));
      }

      // Set new timer
      var timer = setTimeout(
        function () {
          this.speak(message, "polite");
          this.debounceTimers.delete(debounceKey);
        }.bind(this),
        debounceMs,
      );

      this.debounceTimers.set(debounceKey, timer);
    } else {
      this.speak(message, "polite");
    }
  };

  /**
   * Announce a message assertively (interrupting)
   * @param {string} message
   */
  Announcer.prototype.announceAssertive = function (message) {
    this.speak(message, "assertive");
  };

  /**
   * Internal speak method
   */
  Announcer.prototype.speak = function (message, priority) {
    var region = priority === "assertive" ? this.assertiveRegion : this.politeRegion;
    if (!region) return;

    // Clear and set new message
    region.textContent = "";

    // Small delay to ensure screen reader detects change
    setTimeout(function () {
      region.textContent = message;
    }, 10);
  };

  /**
   * Clean up debounce timers
   */
  Announcer.prototype.destroy = function () {
    this.debounceTimers.forEach(function (timer) {
      clearTimeout(timer);
    });
    this.debounceTimers.clear();
  };

  // Create global instance
  window.A11yAnnouncer = new Announcer();
})();
