const { test, expect } = require("@playwright/test");

test.describe("Chat Rich Content & Security", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".tree-node-content");
  });

  async function openSession(page, sessionId) {
    await page.locator(`.tree-node-content[data-session="${sessionId}"]`).first().click();
    await page.waitForSelector(".chat-open");
    // Wait for chat history to load - use data-ready attribute for reliability
    const messagesContainer = page.locator("#chat-messages");
    await messagesContainer.waitFor({ state: "visible" });
    // Wait for the ready signal from the app
    await expect(messagesContainer).toHaveAttribute("data-ready", "true", { timeout: 10000 });
  }

  // Helper for injection tests that need ChatMessage but don't wait for history
  async function openChatPaneForInjection(page, sessionId) {
    await page.locator(`.tree-node-content[data-session="${sessionId}"]`).first().click();
    await page.waitForSelector(".chat-open");
    // Wait for chat pane to be visible with messages container
    const messagesContainer = page.locator("#chat-messages");
    await messagesContainer.waitFor({ state: "visible" });
    // For injection tests, we just need the modules to be loaded
    await page.waitForFunction(() => typeof window.ChatMessage !== "undefined", { timeout: 5000 });
    await page.waitForFunction(
      () => typeof window.marked !== "undefined" && typeof window.DOMPurify !== "undefined",
      { timeout: 10000 },
    );
    await page.waitForFunction(
      () => window.ChatMarkdown && typeof window.ChatMarkdown.renderMarkdown === "function",
      { timeout: 5000 },
    );
  }

  // ============================================================
  // RICH RENDERING TESTS
  // ============================================================

  test.describe("Markdown Rendering", () => {
    test("headers render correctly", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      // Inject markdown content
      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        // Clear existing messages
        while (container.firstChild) container.removeChild(container.firstChild);

        // Add test message with markdown headers
        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [{ type: "text", text: "# Header 1\n## Header 2\n### Header 3\nNormal text" }],
        });
        container.appendChild(msg);
      });

      // Verify headers rendered
      const content = page.locator(".chat-msg-content");
      await expect(content).toContainText("Header 1");
      await expect(content).toContainText("Header 2");
      await expect(content).toContainText("Header 3");

      // Check for h1, h2, h3 tags
      const h1 = content.locator("h1");
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText("Header 1");

      const h2 = content.locator("h2");
      await expect(h2).toHaveCount(1);
      await expect(h2).toHaveText("Header 2");
    });

    test("lists render correctly", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "text", text: "- Item 1\n- Item 2\n- Item 3\n\n1. Ordered 1\n2. Ordered 2" },
          ],
        });
        container.appendChild(msg);
      });

      const content = page.locator(".chat-msg-content");
      await expect(content).toContainText("Item 1");
      await expect(content).toContainText("Item 2");

      // Check for ul/ol elements
      await expect(content.locator("ul")).toHaveCount(1);
      await expect(content.locator("ol")).toHaveCount(1);
    });

    test("links render with correct attributes", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "text", text: "Check [this link](https://example.com) for more info." },
          ],
        });
        container.appendChild(msg);
      });

      const link = page.locator(".chat-msg-content a");
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute("href", "https://example.com");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(link).toHaveText("this link");
    });

    test("code blocks are styled", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            {
              type: "text",
              text: '```javascript\nfunction hello() {\n  console.log("world");\n}\n```',
            },
          ],
        });
        container.appendChild(msg);
      });

      const pre = page.locator(".chat-msg-content pre");
      await expect(pre).toHaveCount(1);

      const code = pre.locator("code");
      await expect(code).toHaveCount(1);
      await expect(code).toContainText("function hello()");
    });
  });

  test.describe("Tool Blocks", () => {
    test("tool use blocks display and expand/collapse", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector("#chat-messages");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);
        // Remove data-ready to prevent race conditions with pending renders
        delete container.dataset.ready;

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/test/file.txt" },
              id: "tool-1",
            },
            { type: "tool_result", content: "File content here", tool_use_id: "tool-1" },
          ],
        });
        container.appendChild(msg);
        // Mark as ready since we've injected our content
        container.dataset.ready = "true";
      });

      // Check tool use block exists and target the injected block
      const toolUse = page.locator(".chat-tool-use").first();
      await expect(page.locator(".chat-tool-use").first()).toBeVisible();

      // Check header shows tool name and preview
      const header = toolUse.locator(".chat-tool-use-header");
      await expect(header).toContainText("Read");
      await expect(header).toContainText("/test/file.txt");

      // Initially expanded in the current implementation
      await expect(toolUse).toHaveClass(/expanded/);

      // Body should be visible while expanded
      const body = toolUse.locator(".chat-tool-use-body");
      await expect(body).toBeVisible();

      // Click to collapse
      await header.click();
      await expect(toolUse).not.toHaveClass(/expanded/);
      await expect(body).not.toBeVisible();

      // Click to expand again
      await header.click();
      await expect(toolUse).toHaveClass(/expanded/);
      await expect(body).toBeVisible();
    });

    test("tool grouping behavior with 3+ calls", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        // Create message with 3+ tool calls
        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/a.txt" }, id: "t1" },
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: "/b.txt", content: "test" },
              id: "t2",
            },
            { type: "tool_use", name: "exec", input: { command: "ls -la" }, id: "t3" },
          ],
        });
        container.appendChild(msg);
      });

      // Check group wrapper exists
      const group = page.locator(".chat-tool-group");
      await expect(group).toHaveCount(1);
      await expect(group).toHaveText(/3 tool calls/);

      // Initially collapsed
      await expect(group).toHaveClass(/collapsed/);

      // Click to expand
      const groupHeader = group.locator(".chat-tool-group-header");
      await groupHeader.click();
      await expect(group).not.toHaveClass(/collapsed/);

      // Check all 3 tool blocks are visible inside
      const toolBlocks = group.locator(".chat-tool-use");
      await expect(toolBlocks).toHaveCount(3);
    });

    test("less than 3 tool calls are NOT grouped", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/a.txt" }, id: "t1" },
            { type: "tool_use", name: "Write", input: { file_path: "/b.txt" }, id: "t2" },
          ],
        });
        container.appendChild(msg);
      });

      // Should NOT have a group
      const group = page.locator(".chat-tool-group");
      await expect(group).toHaveCount(0);

      // Should have individual tool blocks
      const toolBlocks = page.locator(".chat-tool-use");
      await expect(toolBlocks).toHaveCount(2);
    });
  });

  test.describe("Thinking Blocks", () => {
    test("thinking blocks render correctly", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Let me think about this problem step by step..." },
          ],
        });
        container.appendChild(msg);
      });

      const thinking = page.locator(".chat-thinking-block");
      await expect(thinking).toHaveCount(1);
      await expect(thinking).toContainText("Let me think about this problem");
    });
  });

  // ============================================================
  // SECURITY / SANITIZATION TESTS
  // ============================================================

  test.describe("Security - Dangerous Link Schemes", () => {
    test("javascript: link scheme is sanitized", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [{ type: "text", text: 'Click [here](javascript:alert("xss")) for a prize!' }],
        });
        container.appendChild(msg);
      });

      const link = page.locator(".chat-msg-content a");
      // Should NOT have an anchor tag
      await expect(link).toHaveCount(0);

      // Should just show the text content, not a link
      const content = page.locator(".chat-msg-content");
      await expect(content).toContainText("Click here for a prize!");
      await expect(content).not.toContainText("javascript:");
    });

    test("data: link scheme is sanitized", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "text", text: "See [data](data:text/html,<script>alert(1)</script>) here" },
          ],
        });
        container.appendChild(msg);
      });

      const content = page.locator(".chat-msg-content");
      const link = content.locator("a");
      await expect(link).toHaveCount(0);
    });

    test("vbscript: link scheme is sanitized", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [{ type: "text", text: 'Click [evil](vbscript:msgbox("xss")) link' }],
        });
        container.appendChild(msg);
      });

      const link = page.locator(".chat-msg-content a");
      await expect(link).toHaveCount(0);
    });
  });

  test.describe("Security - Inline Handlers", () => {
    test("onclick handler is removed", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "text", text: 'Test [link](https://example.com "test" onclick="alert(1)")' },
          ],
        });
        container.appendChild(msg);
      });

      const link = page.locator(".chat-msg-content a");
      await expect(link).toHaveCount(1);
      await expect(link).not.toHaveAttribute("onclick");
    });

    test("onerror handler is removed", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [{ type: "text", text: '<img src="x" onerror="alert(1)">' }],
        });
        container.appendChild(msg);
      });

      // img should be stripped - only safe tags allowed
      const content = page.locator(".chat-msg-content");
      await expect(content.locator("img")).toHaveCount(0);
    });

    test("onload handler is removed", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "text", text: '<script>alert(1)</script><img src="x" onload="evil()">' },
          ],
        });
        container.appendChild(msg);
      });

      const content = page.locator(".chat-msg-content");
      // Script tags should be stripped
      await expect(content.locator("script")).toHaveCount(0);
      await expect(content.locator("img")).toHaveCount(0);
    });
  });

  test.describe("Security - Raw HTML Attempts", () => {
    test("raw script tags are sanitized", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [{ type: "text", text: '<script>alert("xss")</script>Hello World' }],
        });
        container.appendChild(msg);
      });

      const content = page.locator(".chat-msg-content");
      await expect(content.locator("script")).toHaveCount(0);
      await expect(content).toContainText("Hello World");
      // Script content should be escaped - use evaluate to check innerHTML
      const innerHTML = await content.evaluate((el) => el.innerHTML);
      expect(innerHTML).not.toContain("<script>");
    });

    test("iframe tags are sanitized", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [{ type: "text", text: '<iframe src="evil.com"></iframe>Safe text' }],
        });
        container.appendChild(msg);
      });

      const content = page.locator(".chat-msg-content");
      await expect(content.locator("iframe")).toHaveCount(0);
      await expect(content).toContainText("Safe text");
    });

    test("object tags are sanitized", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [{ type: "text", text: '<object data="evil.swf"></object>Safe' }],
        });
        container.appendChild(msg);
      });

      const content = page.locator(".chat-msg-content");
      await expect(content.locator("object")).toHaveCount(0);
    });
  });

  test.describe("Security - Nested HTML Payloads", () => {
    test("nested script in anchor is sanitized", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "text", text: '<a href="javascript:alert(1)"><script>evil()</script></a>' },
          ],
        });
        container.appendChild(msg);
      });

      const content = page.locator(".chat-msg-content");
      await expect(content.locator("a")).toHaveCount(0);
      await expect(content.locator("script")).toHaveCount(0);
    });

    test("SVG onload is sanitized", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "text", text: '<svg onload="alert(1)"><circle r="50"></circle></svg>' },
          ],
        });
        container.appendChild(msg);
      });

      const content = page.locator(".chat-msg-content");
      // SVG should be stripped (not in allowed tags)
      await expect(content.locator("svg")).toHaveCount(0);
    });

    test("form with onsubmit is sanitized", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "text", text: '<form onsubmit="evil()"><input type="text"></form>Text' },
          ],
        });
        container.appendChild(msg);
      });

      const content = page.locator(".chat-msg-content");
      await expect(content.locator("form")).toHaveCount(0);
      await expect(content).toContainText("Text");
    });
  });

  test.describe("Security - Link Protection", () => {
    test('external links have rel="noopener noreferrer"', async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [{ type: "text", text: "Visit [Google](https://google.com) for search" }],
        });
        container.appendChild(msg);
      });

      const link = page.locator(".chat-msg-content a");
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  // ============================================================
  // ACCESSIBILITY TESTS
  // ============================================================

  test.describe("Accessibility", () => {
    test("tool block headers are keyboard accessible", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector("#chat-messages");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);
        // Remove data-ready to prevent race conditions with pending renders
        delete container.dataset.ready;

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/test.txt" }, id: "t1" },
          ],
        });
        container.appendChild(msg);
        // Mark as ready since we've injected our content
        container.dataset.ready = "true";
      });

      // Use specific selector for the injected tool use block
      const toolUse = page.locator('.chat-tool-use[data-tool-use-id="t1"]');
      const header = toolUse.locator(".chat-tool-use-header");

      // Focus the tool block header and verify keyboard operation
      await header.focus();
      await expect(header).toBeFocused();

      // Press Enter to toggle from expanded -> collapsed
      await page.keyboard.press("Enter");
      await expect(toolUse).not.toHaveClass(/expanded/);

      // Press Space to toggle back collapsed -> expanded
      await page.keyboard.press(" ");
      await expect(toolUse).toHaveClass(/expanded/);
    });

    test("tool group headers are keyboard accessible", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector("#chat-messages");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);
        // Remove data-ready to prevent race conditions with pending renders
        delete container.dataset.ready;

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "tool_use", name: "exec", input: { command: "a" }, id: "t1" },
            { type: "tool_use", name: "exec", input: { command: "b" }, id: "t2" },
            { type: "tool_use", name: "exec", input: { command: "c" }, id: "t3" },
          ],
        });
        container.appendChild(msg);
        // Mark as ready since we've injected our content
        container.dataset.ready = "true";
      });

      const groupHeader = page.locator(".chat-tool-group-header");

      await groupHeader.focus();
      await expect(groupHeader).toBeFocused();
      await page.keyboard.press("Enter");

      const group = page.locator(".chat-tool-group");
      await expect(group).not.toHaveClass(/collapsed/);
    });

    test("aria-expanded state updates on toggle", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector("#chat-messages");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);
        // Remove data-ready to prevent race conditions with pending renders
        delete container.dataset.ready;

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/test.txt" }, id: "t1" },
          ],
        });
        container.appendChild(msg);
        // Mark as ready since we've injected our content
        container.dataset.ready = "true";
      });

      // Use specific selector for the injected tool use block
      const header = page.locator('.chat-tool-use[data-tool-use-id="t1"] .chat-tool-use-header');

      // Initial state is expanded
      await expect(header).toHaveAttribute("aria-expanded", "true");

      // Click to collapse
      await header.click();
      await expect(header).toHaveAttribute("aria-expanded", "false");

      // Click to expand
      await header.click();
      await expect(header).toHaveAttribute("aria-expanded", "true");
    });

    test("code blocks have proper semantic structure", async ({ page }) => {
      await openChatPaneForInjection(page, "sess-abc-001");
      await page.waitForSelector(".chat-msg");

      await page.evaluate(() => {
        const container = document.getElementById("chat-messages");
        while (container.firstChild) container.removeChild(container.firstChild);

        const msg = window.ChatMessage.renderHistoryMessage({
          role: "assistant",
          content: [{ type: "text", text: '```python\nprint("hello")\n```' }],
        });
        container.appendChild(msg);
      });

      const pre = page.locator(".chat-msg-content pre");
      await expect(pre).toHaveCount(1);

      const code = pre.locator("code");
      await expect(code).toHaveCount(1);
    });
  });
});
