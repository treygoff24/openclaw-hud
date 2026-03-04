window.HUD = window.HUD || {};
HUD.sessionTree = (function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const collapseState = {};
  const COLLAPSED_TOGGLE_CHAR = "▸";
  const EXPANDED_TOGGLE_CHAR = "▾";

  function buildTreeHTML(sessions) {
    if (!Array.isArray(sessions)) sessions = [];
    const byKey = {};
    sessions.forEach((s) => {
      byKey[s.key] = s;
    });
    const children = {};
    const roots = [];
    sessions.forEach((s) => {
      if (s.spawnedBy && byKey[s.spawnedBy]) {
        if (!children[s.spawnedBy]) children[s.spawnedBy] = [];
        children[s.spawnedBy].push(s);
      } else {
        roots.push(s);
      }
    });
    for (const k in children) children[k].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    roots.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    function renderNode(node, prefix, isLast, level = 0) {
      const statusMap = {
        active: "status-dot-green",
        completed: "status-dot-completed",
        warm: "status-dot-amber",
        stale: "status-dot-gray",
      };
      const dotClass = statusMap[node.status] || "status-dot-gray";
      const meta = window.SessionLabels.getDisplayMeta(node);
      const rawLabel = node.label || node.key;
      const sessionKey = node.sessionKey;
      if (!sessionKey || typeof sessionKey !== "string") {
        throw new Error("sessionTree.render requires canonical sessionKey for each node");
      }
      const kids = children[node.key] || [];
      const hasKids = kids.length > 0;
      const collapsed = collapseState[node.key] === true;
      const toggleChar = collapsed ? COLLAPSED_TOGGLE_CHAR : EXPANDED_TOGGLE_CHAR;
      const countBadge =
        hasKids && collapsed
          ? `<span class="tree-child-count" aria-label="${kids.length} children">${kids.length}</span>`
          : "";
      const ariaExpanded = hasKids ? (collapsed ? "false" : "true") : undefined;
      const fullContext = window.SessionLabels.buildSessionAriaLabel(node, meta);

      const toggle = hasKids
        ? `<span class="tree-toggle" data-toggle-key="${escapeHtml(
            node.key,
          )}" role="button" tabindex="0" aria-label="${collapsed ? "Expand" : "Collapse"}" aria-expanded="${ariaExpanded}">${toggleChar}</span>`
        : "";

      let html = `<div class="tree-node" role="treeitem" ${ariaExpanded ? `aria-expanded="${ariaExpanded}"` : ""} aria-level="${level + 1}">
        <div class="tree-node-content" data-tree-key="${escapeHtml(node.key)}" data-agent="${escapeHtml(node.agentId || "")}" data-session="${escapeHtml(node.sessionId || "")}" data-session-key="${escapeHtml(sessionKey)}" data-label="${escapeHtml(rawLabel)}" title="${escapeHtml(fullContext)}" aria-label="${escapeHtml(fullContext)}" tabindex="0" role="button">
          <span class="tree-indent" aria-hidden="true">${escapeHtml(prefix)}</span>
          ${toggle}
          <div class="${dotClass}" aria-hidden="true"></div>
          <span class="tree-label"><span class="session-label-role">${escapeHtml(meta.roleLabel)}</span><span class="session-label-sep"> · </span><span class="session-label-model">${escapeHtml(meta.modelLabel)}</span><span class="session-label-sep"> · </span><span class="session-label-alias">${escapeHtml(meta.sessionAlias)}</span></span>
          <span class="tree-agent">${escapeHtml(node.agentId || "")}</span>
          ${countBadge}
          <span class="tree-age" aria-hidden="true">${HUD.utils.timeAgo(node.updatedAt)}</span>
        </div>`;

      if (hasKids) {
        html += `<div class="tree-children${collapsed ? " collapsed" : ""}" role="group">`;
        kids.forEach((kid, i) => {
          const kidIsLast = i === kids.length - 1;
          const childPrefix = prefix + (isLast ? "   " : "│  ");
          const connector = kidIsLast ? "└─ " : "├─ ";
          html += renderNode(kid, childPrefix + connector, kidIsLast, level + 1);
        });
        html += "</div>";
      }
      html += "</div>";
      return html;
    }

    let html = '<div class="tree-root" role="tree">';
    roots.forEach((r, i) => {
      const connector = i === roots.length - 1 ? "└─ " : "├─ ";
      html += renderNode(r, connector, i === roots.length - 1, 0);
    });
    html += "</div>";
    return html;
  }

  function updateTree() {
    const treeBody = $("#tree-body");
    if (!treeBody || !window._treeData) return;

    const nextHTML = buildTreeHTML(window._treeData);
    const temp = document.createElement("div");
    temp.innerHTML = nextHTML;

    if (typeof morphdom !== "undefined") {
      morphdom(treeBody, temp, { childrenOnly: true });
    } else {
      // Fallback to innerHTML if morphdom not available
      treeBody.innerHTML = nextHTML;
    }
  }

  function getTreeNodeElements(key) {
    const treeBody = $("#tree-body");
    if (!treeBody) return null;

    const nodeContents = treeBody.querySelectorAll(".tree-node-content[data-tree-key]");
    const nodeContent = Array.from(nodeContents).find((node) => node.dataset.treeKey === key);
    if (!nodeContent) return null;

    const treeNode = nodeContent.closest(".tree-node");
    if (!treeNode) return null;

    return {
      treeNode,
      nodeContent,
      toggle: treeNode.querySelector(".tree-toggle"),
      children: treeNode.querySelector(".tree-children"),
    };
  }

  function applyCollapsedState(key) {
    const parts = getTreeNodeElements(key);
    if (!parts) return false;

    const { treeNode, nodeContent, toggle, children } = parts;
    const hasKids = !!children;
    const collapsed = collapseState[key] === true;
    const toggleChar = collapsed ? COLLAPSED_TOGGLE_CHAR : EXPANDED_TOGGLE_CHAR;

    if (nodeContent) {
      const node = treeNode;
      if (hasKids) {
        node.setAttribute("aria-expanded", collapsed ? "false" : "true");
      } else {
        node.removeAttribute("aria-expanded");
      }
    }

    if (children) {
      if (collapsed) {
        children.classList.add("collapsed");
      } else {
        children.classList.remove("collapsed");
      }
    }

    if (toggle) {
      toggle.textContent = toggleChar;
      toggle.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }

    return true;
  }

  function render(sessions) {
    if (!Array.isArray(sessions)) sessions = [];
    for (const s of sessions) {
      if (!s.sessionKey)
        throw new Error("sessionTree.render requires canonical sessionKey for each node");
    }
    window._treeData = sessions;
    $("#tree-count").textContent = sessions.length;
    updateTree();
  }

  function toggleNode(key) {
    collapseState[key] = !collapseState[key];
    const applied = applyCollapsedState(key);
    if (!applied && window._treeData) updateTree();
  }

  // Event delegation handler for the tree container
  function handleTreeClick(e) {
    const toggle = e.target.closest(".tree-toggle");
    if (toggle) {
      const key = toggle.dataset.toggleKey;
      if (key) {
        e.stopPropagation();
        toggleNode(key);
      }
      return;
    }

    const nodeContent = e.target.closest(".tree-node-content");
    if (nodeContent) {
      const agent = nodeContent.dataset.agent;
      const session = nodeContent.dataset.session;
      const sessionKey = nodeContent.dataset.sessionKey;
      const label = nodeContent.dataset.label;
      if (agent && sessionKey) {
        openChatPane(agent, session || "", label || "", sessionKey);
      }
    }
  }

  function getVisibleTreeNodes() {
    const allNodes = document.querySelectorAll(".tree-node-content");
    return Array.from(allNodes).filter((node) => !node.closest(".tree-children.collapsed"));
  }

  function getTreeToggle(treeNode) {
    return treeNode.querySelector(".tree-toggle");
  }

  function isExpandedToggle(toggle) {
    return toggle && toggle.getAttribute("aria-expanded") === "true";
  }

  function isCollapsedToggle(toggle) {
    return toggle && toggle.getAttribute("aria-expanded") === "false";
  }

  // Keyboard navigation handler for the tree container
  function handleTreeKeydown(e) {
    const nodeContent = e.target.closest(".tree-node-content");
    if (!nodeContent) return;

    const treeNode = nodeContent.closest(".tree-node");
    if (!treeNode) return;

    switch (e.key) {
      case "Enter":
      case " ":
        // Check if we're on a toggle
        if (e.target.classList.contains("tree-toggle")) {
          e.preventDefault();
          e.stopPropagation();
          const key = e.target.dataset.toggleKey;
          if (key) toggleNode(key);
          return;
        }
        // Otherwise trigger click on node content
        e.preventDefault();
        const agent = nodeContent.dataset.agent;
        const session = nodeContent.dataset.session;
        const sessionKey = nodeContent.dataset.sessionKey;
        const label = nodeContent.dataset.label;
        if (agent && sessionKey) {
          openChatPane(agent, session || "", label || "", sessionKey);
        }
        break;

      case "ArrowRight":
        e.preventDefault();
        const toggle = getTreeToggle(treeNode);
        if (isCollapsedToggle(toggle)) {
          const key = toggle.dataset.toggleKey;
          if (key) toggleNode(key);
        } else {
          // Move to first child
          const firstChild = treeNode.querySelector(
            ".tree-children > .tree-node > .tree-node-content",
          );
          if (firstChild) firstChild.focus();
        }
        break;

      case "ArrowLeft":
        e.preventDefault();
        // Collapse if expanded
        const toggleLeft = getTreeToggle(treeNode);
        if (isExpandedToggle(toggleLeft)) {
          const key = toggleLeft.dataset.toggleKey;
          if (key) toggleNode(key);
        } else {
          // Move to parent
          const parent = treeNode.closest(".tree-children")?.closest(".tree-node");
          if (parent) {
            const parentContent = parent.querySelector(".tree-node-content");
            if (parentContent) parentContent.focus();
          }
        }
        break;

      case "ArrowDown":
        e.preventDefault();
        // Move to next visible node
        const allNodes = getVisibleTreeNodes();
        const currentIndex = allNodes.indexOf(nodeContent);
        if (currentIndex < allNodes.length - 1) {
          allNodes[currentIndex + 1].focus();
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        // Move to previous visible node
        const allNodesUp = getVisibleTreeNodes();
        const currentIndexUp = allNodesUp.indexOf(nodeContent);
        if (currentIndexUp > 0) {
          allNodesUp[currentIndexUp - 1].focus();
        }
        break;

      case "Home":
        e.preventDefault();
        const visibleNodesHome = getVisibleTreeNodes();
        if (visibleNodesHome.length > 0) {
          visibleNodesHome[0].focus();
        }
        break;

      case "End":
        e.preventDefault();
        const visibleNodesEnd = getVisibleTreeNodes();
        if (visibleNodesEnd.length > 0) {
          visibleNodesEnd[visibleNodesEnd.length - 1].focus();
        }
        break;
    }
  }

  // Initialize event delegation once
  function init() {
    const treeBody = $("#tree-body");
    if (treeBody) {
      treeBody.addEventListener("click", handleTreeClick);
      treeBody.addEventListener("keydown", handleTreeKeydown);
    }
  }

  // Auto-init when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { render, toggleNode, init };
})();
