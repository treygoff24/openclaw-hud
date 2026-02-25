import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Keyboard Navigation in Panels", () => {
  describe("Agents Panel", () => {
    it("should render agent cards with tabindex and role", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/agents.js", "utf8");

      expect(jsContent).toMatch(/role="listitem"/);
      expect(jsContent).toMatch(/tabindex="0"/);
      expect(jsContent).toMatch(/aria-label="Agent/);
    });

    it("should call makeFocusable on agent cards", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/agents.js", "utf8");

      expect(jsContent).toMatch(/window\.makeFocusable/);
      expect(jsContent).toMatch(/\.agent-card/);
    });

    it("should support Escape key to clear search", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/agents.js", "utf8");

      expect(jsContent).toMatch(/key === ["']Escape["']/);
    });
  });

  describe("Sessions Panel", () => {
    it("should render session rows with tabindex and role", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/sessions.js", "utf8");

      expect(jsContent).toMatch(/role="listitem"/);
      expect(jsContent).toMatch(/tabindex="0"/);
      expect(jsContent).toMatch(/aria-label=/);
    });

    it("should call makeFocusable on session rows", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/sessions.js", "utf8");

      expect(jsContent).toMatch(/window\.makeFocusable/);
      expect(jsContent).toMatch(/querySelectorAll.*session-row/);
    });
  });

  describe("Cron Panel", () => {
    it("should render cron rows with tabindex and role", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/cron.js", "utf8");

      expect(jsContent).toMatch(/role="listitem"/);
      expect(jsContent).toMatch(/tabindex="0"/);
      expect(jsContent).toMatch(/aria-label="Cron job/);
    });

    it("should use focus trap in modal", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/cron.js", "utf8");

      expect(jsContent).toMatch(/FocusTrap/);
      expect(jsContent).toMatch(/_focusTrap\.activate/);
      expect(jsContent).toMatch(/_focusTrap\.deactivate/);
    });
  });

  describe("Session Tree Panel", () => {
    it("should render with tree ARIA roles", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/session-tree.js", "utf8");

      expect(jsContent).toMatch(/role="tree"/);
      expect(jsContent).toMatch(/role="treeitem"/);
      expect(jsContent).toMatch(/role="group"/);
    });

    it("should support arrow key navigation", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/session-tree.js", "utf8");

      expect(jsContent).toMatch(/ArrowRight/);
      expect(jsContent).toMatch(/ArrowLeft/);
      expect(jsContent).toMatch(/ArrowDown/);
      expect(jsContent).toMatch(/ArrowUp/);
      expect(jsContent).toMatch(/Home/);
      expect(jsContent).toMatch(/End/);
    });

    it("should support aria-expanded on tree nodes", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/session-tree.js", "utf8");

      expect(jsContent).toMatch(/aria-expanded/);
    });
  });

  describe("Spawn Modal", () => {
    it("should use focus trap", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/spawn.js", "utf8");

      expect(jsContent).toMatch(/FocusTrap/);
      expect(jsContent).toMatch(/_focusTrap\.activate/);
    });

    it("should restore focus on close", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/spawn.js", "utf8");

      expect(jsContent).toMatch(/_triggerElement/);
      expect(jsContent).toMatch(/_triggerElement\.focus/);
    });

    it("should announce to screen readers on open", () => {
      const fs = require("fs");
      const jsContent = fs.readFileSync("./public/panels/spawn.js", "utf8");

      expect(jsContent).toMatch(/A11yAnnouncer/);
      expect(jsContent).toMatch(/announce.*Spawn session dialog/);
    });
  });
});

describe("Focus Indicators in CSS", () => {
  it("should have focus-visible styles", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/:focus-visible/);
    expect(cssContent).toMatch(/outline:\s*2px\s+solid\s+var\(--cyan\)/);
  });

  it("should remove outline for mouse focus", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/:focus:not\(:focus-visible\)/);
    expect(cssContent).toMatch(/outline:\s*none/);
  });

  it("should have custom focus styles for interactive elements", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/button:focus-visible/);
    expect(cssContent).toMatch(/\.hud-btn:focus-visible/);
    expect(cssContent).toMatch(/\.agent-card:focus-visible/);
    expect(cssContent).toMatch(/\.session-row:focus-visible/);
  });
});

describe("Modal Keyboard Support", () => {
  it("should close on Escape key", () => {
    const fs = require("fs");
    const appUiContent = fs.readFileSync("./public/app/ui.js", "utf8");

    expect(appUiContent).toMatch(/event\.key !== ["']Escape["']/);
    expect(appUiContent).toMatch(/#spawn-modal/);
    expect(appUiContent).toMatch(/#cron-modal/);
  });

  it("should have dialog role and aria-modal", () => {
    const fs = require("fs");
    const htmlContent = fs.readFileSync("./public/index.html", "utf8");

    expect(htmlContent).toMatch(/role="dialog"/);
    expect(htmlContent).toMatch(/aria-modal="true"/);
  });

  it("should have close buttons with aria-label", () => {
    const fs = require("fs");
    const htmlContent = fs.readFileSync("./public/index.html", "utf8");

    expect(htmlContent).toMatch(/aria-label="Close spawn dialog"/);
    expect(htmlContent).toMatch(/aria-label="Close cron editor"/);
  });
});

describe("Chat Input Keyboard Support", () => {
  it("should support Enter to send message", () => {
    const fs = require("fs");
    const jsContent = fs.readFileSync("./public/chat-input.js", "utf8");

    expect(jsContent).toMatch(/key === ["']Enter["']/);
  });

  it("should support Shift+Enter for newline", () => {
    const fs = require("fs");
    const jsContent = fs.readFileSync("./public/chat-input.js", "utf8");

    expect(jsContent).toMatch(/e\.shiftKey/);
  });

  it("should have aria-label on input", () => {
    const fs = require("fs");
    const htmlContent = fs.readFileSync("./public/index.html", "utf8");

    expect(htmlContent).toMatch(/aria-label="Message text"/);
  });
});
