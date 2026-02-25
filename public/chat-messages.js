// Chat Messages Module — Virtual Scrolling for Large Conversations
(function() {
  'use strict';

  const DEFAULT_ITEM_HEIGHT = 80; // Estimated average message height
  const BUFFER_ITEMS = 5; // Extra items to render above/below viewport
  const SCROLL_DEBOUNCE = 16; // ~60fps

  function VirtualScroller() {
    this.container = null;
    this.items = [];
    this.totalItems = 0;
    this.itemHeight = DEFAULT_ITEM_HEIGHT;
    this.totalHeight = 0;
    this.visibleRange = { start: 0, end: 0 };
    this.observer = null;
    this.scrollHandler = null;
    this.debounceTimer = null;
    this.resizeObserver = null;
    this.spacerTop = null;
    this.spacerBottom = null;
    this.contentContainer = null;
    this.renderedElements = new Map(); // Track rendered elements by index
    this.recyclePool = []; // Pool of recycled DOM elements
  }

  VirtualScroller.prototype.initialize = function(container) {
    this.container = container;
    
    // Clear container and create structure
    container.innerHTML = '';
    
    // Create spacer elements for scroll height
    this.spacerTop = document.createElement('div');
    this.spacerTop.className = 'virtual-spacer-top';
    this.spacerTop.style.height = '0px';
    
    this.contentContainer = document.createElement('div');
    this.contentContainer.className = 'virtual-content';
    
    this.spacerBottom = document.createElement('div');
    this.spacerBottom.className = 'virtual-spacer-bottom';
    this.spacerBottom.style.height = '0px';
    
    container.appendChild(this.spacerTop);
    container.appendChild(this.contentContainer);
    container.appendChild(this.spacerBottom);
    
    // Set up IntersectionObserver for lazy rendering
    this.observer = new IntersectionObserver(
      this.handleIntersection.bind(this),
      { root: container, rootMargin: '100px', threshold: 0 }
    );
    
    // Debounced scroll handler
    this.scrollHandler = this.debounce(
      this.handleScroll.bind(this),
      SCROLL_DEBOUNCE
    );
    
    container.addEventListener('scroll', this.scrollHandler, { passive: true });
    
    // Resize observer for dynamic height adjustments
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(this.handleResize.bind(this));
      this.resizeObserver.observe(container);
    }
    
    return this;
  };

  VirtualScroller.prototype.setItems = function(items) {
    // Clean up existing rendered elements
    this.clearRenderedElements();
    
    this.items = items || [];
    this.totalItems = this.items.length;
    
    // Calculate total scroll height
    this.totalHeight = this.totalItems * this.itemHeight;
    
    // Update spacer heights
    this.spacerTop.style.height = '0px';
    this.spacerBottom.style.height = this.totalHeight + 'px';
    
    // Calculate initial visible range
    this.calculateVisibleRange();
    
    // Render initial items
    this.renderVisibleItems();
    
    return this;
  };

  VirtualScroller.prototype.calculateVisibleRange = function() {
    const containerHeight = this.container.clientHeight;
    const scrollTop = this.container.scrollTop;
    
    const startIdx = Math.max(0, Math.floor(scrollTop / this.itemHeight) - BUFFER_ITEMS);
    const endIdx = Math.min(
      this.totalItems,
      Math.ceil((scrollTop + containerHeight) / this.itemHeight) + BUFFER_ITEMS
    );
    
    this.visibleRange = { start: startIdx, end: endIdx };
    return this.visibleRange;
  };

  VirtualScroller.prototype.renderVisibleItems = function() {
    const { start, end } = this.visibleRange;
    const currentRendered = new Set(this.renderedElements.keys());
    const toRender = new Set();
    
    // Determine which indices need rendering
    for (let i = start; i < end; i++) {
      if (i < this.totalItems) {
        toRender.add(i);
      }
    }
    
    // Remove elements that are no longer visible
    currentRendered.forEach(idx => {
      if (!toRender.has(idx)) {
        this.removeItem(idx);
      }
    });
    
    // Add new elements
    const fragment = document.createDocumentFragment();
    let lastElement = null;
    
    for (let i = start; i < end; i++) {
      if (i >= this.totalItems) break;
      
      if (!this.renderedElements.has(i)) {
        const el = this.createOrRecycleElement(i);
        fragment.appendChild(el);
        this.renderedElements.set(i, el);
        lastElement = el;
      }
    }
    
    if (fragment.childNodes.length > 0) {
      this.contentContainer.appendChild(fragment);
    }
    
    // Update spacer heights to maintain scroll position
    const topHeight = start * this.itemHeight;
    const visibleHeight = (end - start) * this.itemHeight;
    const bottomHeight = this.totalHeight - topHeight - visibleHeight;
    
    this.spacerTop.style.height = topHeight + 'px';
    this.spacerBottom.style.height = Math.max(0, bottomHeight) + 'px';
  };

  VirtualScroller.prototype.createOrRecycleElement = function(index) {
    const item = this.items[index];
    let el;
    
    // Try to recycle from pool
    if (this.recyclePool.length > 0) {
      el = this.recyclePool.pop();
      el.innerHTML = '';
      el.className = '';
    } else {
      el = document.createElement('div');
    }
    
    // Render the message
    if (window.ChatMessage && item) {
      const messageEl = window.ChatMessage.renderHistoryMessage(item);
      // Copy attributes and children
      el.className = messageEl.className;
      el.innerHTML = messageEl.innerHTML;
      // Preserve dataset
      if (messageEl.dataset) {
        Object.assign(el.dataset, messageEl.dataset);
      }
    } else {
      el.className = 'chat-msg';
      el.textContent = item?.content?.[0]?.text || '';
    }
    
    el.style.minHeight = this.itemHeight + 'px';
    el.dataset.index = index;
    
    return el;
  };

  VirtualScroller.prototype.removeItem = function(index) {
    const el = this.renderedElements.get(index);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
      // Add to recycle pool (limit pool size)
      if (this.recyclePool.length < 50) {
        this.recyclePool.push(el);
      }
    }
    this.renderedElements.delete(index);
  };

  VirtualScroller.prototype.clearRenderedElements = function() {
    this.renderedElements.forEach((el, idx) => {
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
        if (this.recyclePool.length < 50) {
          this.recyclePool.push(el);
        }
      }
    });
    this.renderedElements.clear();
    if (this.contentContainer) {
      this.contentContainer.innerHTML = '';
    }
  };

  VirtualScroller.prototype.handleScroll = function() {
    this.calculateVisibleRange();
    this.renderVisibleItems();
  };

  VirtualScroller.prototype.handleIntersection = function(entries) {
    // Can be used for more advanced lazy loading
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const index = parseInt(entry.target.dataset.index, 10);
        if (!isNaN(index)) {
          // Item is becoming visible
        }
      }
    });
  };

  VirtualScroller.prototype.handleResize = function() {
    // Recalculate on resize
    this.calculateVisibleRange();
    this.renderVisibleItems();
  };

  VirtualScroller.prototype.getScrollTopForIndex = function(index) {
    return index * this.itemHeight;
  };

  VirtualScroller.prototype.scrollToIndex = function(index, behavior = 'smooth') {
    const scrollTop = this.getScrollTopForIndex(index);
    this.container.scrollTo({ top: scrollTop, behavior });
  };

  VirtualScroller.prototype.debounce = function(fn, ms) {
    const self = this;
    return function(...args) {
      if (self.debounceTimer) {
        clearTimeout(self.debounceTimer);
      }
      self.debounceTimer = setTimeout(() => {
        fn.apply(self, args);
      }, ms);
    };
  };

  VirtualScroller.prototype.destroy = function() {
    // Clean up all resources
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    
    if (this.container && this.scrollHandler) {
      this.container.removeEventListener('scroll', this.scrollHandler);
    }
    
    this.clearRenderedElements();
    this.recyclePool = [];
    this.items = [];
    this.totalItems = 0;
    this.totalHeight = 0;
    this.visibleRange = { start: 0, end: 0 };
    this.container = null;
    this.spacerTop = null;
    this.spacerBottom = null;
    this.contentContainer = null;
    this.scrollHandler = null;
  };

  // Memory leak detection helper
  VirtualScroller.prototype.getMemoryStats = function() {
    return {
      totalItems: this.totalItems,
      renderedItems: this.renderedElements.size,
      recycledPool: this.recyclePool.length,
      visibleRange: { ...this.visibleRange }
    };
  };

  // Export
  window.VirtualScroller = new VirtualScroller();
})();
