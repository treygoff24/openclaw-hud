// A11y Focus Trap Module — Trap focus within a modal/container
(function () {
  "use strict";

  /**
   * FocusTrap class — manages focus within a container
   * @param {HTMLElement} container — The container to trap focus within
   */
  function FocusTrap(container) {
    this.container = container;
    this.previouslyFocused = document.activeElement;
    this.focusableElements = [];
    this.firstFocusable = null;
    this.lastFocusable = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleFocusIn = this.handleFocusIn.bind(this);
  }

  /**
   * Get all focusable elements within the container
   * @returns {Array<HTMLElement>}
   */
  FocusTrap.prototype.getFocusableElements = function () {
    const selector = [
      "button:not([disabled])",
      "a[href]",
      'input:not([disabled]):not([type="hidden"])',
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"]):not([disabled])',
      "[contenteditable]",
      "summary",
    ].join(", ");

    return Array.from(this.container.querySelectorAll(selector)).filter(function (el) {
      // Check visibility
      if (el.offsetParent === null) return false;
      // Check for aria-hidden
      if (el.closest('[aria-hidden="true"]')) return false;
      return true;
    });
  };

  /**
   * Activate the focus trap
   */
  FocusTrap.prototype.activate = function () {
    this.focusableElements = this.getFocusableElements();

    if (this.focusableElements.length === 0) {
      // No focusable elements, make container focusable
      this.container.setAttribute("tabindex", "-1");
      this.container.focus();
      this.firstFocusable = this.container;
      this.lastFocusable = this.container;
    } else {
      this.firstFocusable = this.focusableElements[0];
      this.lastFocusable = this.focusableElements[this.focusableElements.length - 1];

      // Focus first element
      this.firstFocusable.focus();
    }

    // Add event listeners
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("focusin", this.handleFocusIn);
  };

  /**
   * Deactivate the focus trap
   */
  FocusTrap.prototype.deactivate = function () {
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("focusin", this.handleFocusIn);

    // Restore previous focus
    if (this.previouslyFocused && this.previouslyFocused.focus) {
      this.previouslyFocused.focus();
    }
  };

  /**
   * Handle Tab key to cycle focus
   */
  FocusTrap.prototype.handleKeyDown = function (e) {
    if (e.key !== "Tab") return;

    const currentFocus = document.activeElement;
    const isForward = !e.shiftKey;

    if (isForward) {
      // Tab forward
      if (currentFocus === this.lastFocusable || !this.container.contains(currentFocus)) {
        e.preventDefault();
        this.firstFocusable.focus();
      }
    } else {
      // Tab backward (Shift+Tab)
      if (currentFocus === this.firstFocusable || !this.container.contains(currentFocus)) {
        e.preventDefault();
        this.lastFocusable.focus();
      }
    }
  };

  /**
   * Prevent focus from leaving the container
   */
  FocusTrap.prototype.handleFocusIn = function (e) {
    if (!this.container.contains(e.target)) {
      e.preventDefault();
      this.firstFocusable.focus();
    }
  };

  // Expose to global
  window.FocusTrap = FocusTrap;

  /**
   * Simple utility to make an element focusable with keyboard
   * @param {HTMLElement} element
   * @param {Function} onActivate — Callback when activated (Enter/Space)
   */
  window.makeFocusable = function (element, onActivate) {
    if (!element) return;

    // If not naturally focusable, add tabindex and role
    if (!element.matches("button, a[href], input, select, textarea, [tabindex]")) {
      element.setAttribute("tabindex", "0");
      if (!element.getAttribute("role")) {
        element.setAttribute("role", "button");
      }
    }

    const stateKey = "__makeFocusableState__";
    const existing = element[stateKey] || null;

    if (existing) {
      existing.onActivate = onActivate || null;
      return;
    }

    const state = {
      onActivate: onActivate || null,
    };

    // Add keyboard handler
    state.keydownHandler = function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (state.onActivate) state.onActivate(e);
        else element.click();
      }
    };

    // Add focus visible class support
    state.focusHandler = function () {
      element.classList.add("focus-visible");
    };

    state.blurHandler = function () {
      element.classList.remove("focus-visible");
    };

    element[stateKey] = state;

    element.addEventListener("keydown", state.keydownHandler);
    element.addEventListener("focus", state.focusHandler);
    element.addEventListener("blur", state.blurHandler);
  };
})();
