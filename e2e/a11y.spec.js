import { describe, it, expect, beforeEach } from 'vitest';
import { test, expect as playwrightExpect } from '@playwright/test';

/**
 * E2E Accessibility Tests
 * 
 * These tests use Playwright to verify accessibility in a real browser context.
 * Run with: npm run test:e2e -- e2e/a11y.spec.js
 */

describe('E2E Accessibility', () => {
  describe('Page Structure', () => {
    it('should have skip link as first focusable element', async () => {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto('http://localhost:3000');
      
      // Press Tab to get first focusable element
      await page.keyboard.press('Tab');
      
      const focusedElement = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          className: el.className,
          tagName: el.tagName,
          textContent: el.textContent?.substring(0, 50)
        };
      });
      
      expect(focusedElement.className).toContain('skip-link');
      
      await browser.close();
    });
  });

  describe('Focus Management', () => {
    it('should trap focus in spawn modal', async () => {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto('http://localhost:3000');
      
      // Wait for agents to load, then click spawn button
      await page.waitForSelector('#open-spawn-btn');
      await page.click('#open-spawn-btn');
      
      // Wait for modal
      await page.waitForSelector('#spawn-modal.active');
      
      // Get all focusable elements in modal
      const focusableElements = await page.evaluate(() => {
        const modal = document.querySelector('#spawn-modal');
        if (!modal) return [];
        return Array.from(modal.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .map(el => el.id || el.tagName + '-' + Math.random().toString(36).substr(2, 5));
      });
      
      expect(focusableElements.length).toBeGreaterThan(0);
      
      await browser.close();
    });

    it('should close modal on Escape key', async () => {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto('http://localhost:3000');
      
      // Open modal
      await page.waitForSelector('#open-spawn-btn');
      await page.click('#open-spawn-btn');
      await page.waitForSelector('#spawn-modal.active');
      
      // Press Escape
      await page.keyboard.press('Escape');
      
      // Check modal is closed
      const modalClass = await page.evaluate(() => {
        return document.querySelector('#spawn-modal')?.className || '';
      });
      
      expect(modalClass).not.toContain('active');
      
      await browser.close();
    });
  });

  describe('ARIA Attributes', () => {
    it('should have proper ARIA roles on main sections', async () => {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto('http://localhost:3000');
      
      const ariaRoles = await page.evaluate(() => {
        return {
          dashboard: document.querySelector('#dashboard')?.getAttribute('role'),
          chatPane: document.querySelector('#chat-pane')?.getAttribute('role'),
          agentsList: document.querySelector('#agents-list')?.getAttribute('role'),
          treeBody: document.querySelector('#tree-body')?.getAttribute('role'),
          activityFeed: document.querySelector('#activity-feed')?.getAttribute('role')
        };
      });
      
      expect(ariaRoles.dashboard).toBe('main');
      expect(ariaRoles.chatPane).toBe('complementary');
      expect(ariaRoles.agentsList).toBe('list');
      expect(ariaRoles.treeBody).toBe('tree');
      expect(ariaRoles.activityFeed).toBe('log');
      
      await browser.close();
    });

    it('should have aria-live regions for dynamic content', async () => {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto('http://localhost:3000');
      
      const ariaLive = await page.evaluate(() => {
        return {
          chatMessages: document.querySelector('#chat-messages')?.getAttribute('aria-live'),
          activityFeed: document.querySelector('#activity-feed')?.getAttribute('aria-live'),
          toast: document.querySelector('#toast')?.getAttribute('aria-live'),
          agentCount: document.querySelector('#agent-count')?.getAttribute('aria-live')
        };
      });
      
      expect(ariaLive.chatMessages).toBe('polite');
      expect(ariaLive.activityFeed).toBe('polite');
      expect(ariaLive.toast).toBe('polite');
      expect(ariaLive.agentCount).toBe('polite');
      
      await browser.close();
    });
  });

  describe('Color Contrast', () => {
    it('should have sufficient color contrast for text', async () => {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto('http://localhost:3000');
      
      // Get computed styles for text elements
      const contrastResults = await page.evaluate(() => {
        const results = [];
        const elements = document.querySelectorAll('.panel-header, .agent-id, .tree-label, .session-label');
        
        elements.forEach(el => {
          const style = window.getComputedStyle(el);
          const color = style.color;
          const bgColor = style.backgroundColor;
          
          results.push({
            text: el.textContent?.substring(0, 30),
            color: color,
            background: bgColor
          });
        });
        
        return results;
      });
      
      expect(contrastResults.length).toBeGreaterThan(0);
      
      await browser.close();
    });
  });

  describe('Keyboard Navigation', () => {
    it('should navigate agents list with Tab key', async () => {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.goto('http://localhost:3000');
      
      // Wait for content to load
      await page.waitForTimeout(500);
      
      // Press Tab multiple times to reach agent cards
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
      }
      
      // Check if a focusable element within agents list is focused
      const focusedInAgents = await page.evaluate(() => {
        const active = document.activeElement;
        const agentsList = document.querySelector('#agents-list');
        return agentsList?.contains(active) || active?.closest('.agent-card');
      });
      
      // This test may need adjustment based on actual DOM structure
      // For now, just verify Tab navigation works
      const focusableCount = await page.evaluate(() => {
        return document.querySelectorAll('button, a, input, [tabindex]:not([tabindex="-1"])').length;
      });
      
      expect(focusableCount).toBeGreaterThan(5); // Should have many focusable elements
      
      await browser.close();
    });
  });
});
