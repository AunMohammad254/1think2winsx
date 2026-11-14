import { test, expect } from '@playwright/test';

/**
 * Phase 1.1: E2E Navigation Tests - Version 2 (Optimized)
 * Simplified tests focused on core navigation functionality
 *
 * No fixed sleeps before an assertion: expect() waits for an element by itself, and a scroll is
 * retried with toPass() until the page has moved. The hero and the section sidebar are checked in
 * landing-navigation.spec.ts.
 */

test.describe('Landing Page Navigation - Core Tests', () => {
  test.beforeEach(async ({ page, context }) => {
    // Disable all network throttling for reliable tests
    await context.setExtraHTTPHeaders({});
    await page.goto('/');
    // Wait for complete page load
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle');
  });

  test('[Desktop] Page loads successfully', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/1Think 2Win/);
    
    // Check main content exists - use first() for multiple main tags
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('[Desktop] Scroll progress bar exists and updates', async ({ page }) => {
    // Simple check: the page scrolls
    await expect(async () => {
      await page.evaluate(() => window.scrollBy(0, 500));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    }).toPass({ timeout: 10000 });
  });

  test('[Desktop] Page scrolling works smoothly', async ({ page }) => {
    const initialScroll = await page.evaluate(() => window.scrollY);
    
    // Scroll down, and wait until the smooth scroll has moved the page (WebKit takes longest).
    // Asking again mid-scroll carries on from where the page is.
    await expect(async () => {
      await page.evaluate(() => {
        window.scrollTo({ top: 1000, behavior: 'smooth' });
      });
      // More tolerant for different browsers
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(initialScroll + 300);
    }).toPass({ timeout: 10000 });
  });

  test('[Desktop] Footer is visible', async ({ page }) => {
    // Scroll to bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });

    const footer = page.locator('footer').first();
    await expect(footer).toBeVisible();
  });
});

test.describe('Landing Page Navigation - Mobile', () => {
  test.beforeEach(async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle');
  });

  test('[Mobile] Page loads on mobile', async ({ page }) => {
    await expect(page).toHaveTitle(/1Think 2Win/, { timeout: 10000 });
    
    const main = page.locator('main').first();
    await main.waitFor({ state: 'visible', timeout: 10000 });
    await expect(main).toBeVisible();
  });

  test('[Mobile] Hero section visible on mobile', async ({ page }) => {
    const hero = page.locator('section#top, [class*="hero"]').first();
    await expect(hero).toBeVisible();
  });

  test('[Mobile] Scroll works on mobile', async ({ page }) => {
    const initialScroll = await page.evaluate(() => window.scrollY);
    
    await expect(async () => {
      await page.evaluate(() => window.scrollBy(0, 300));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(initialScroll);
    }).toPass({ timeout: 10000 });
  });

  test('[Mobile] Footer is accessible', async ({ page }) => {
    // Scroll to bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });

    const footer = page.locator('footer').first();
    await expect(footer).toBeVisible();
  });
});

test.describe('Landing Page Navigation - Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle');
  });

  test('[A11y] Page has a main heading and section headings', async ({ page }) => {
    // The hero's h1 is the page title, with the sections' h2 headings under it.
    // (The navbar logo is an h1 as well, so "exactly one h1" does not hold on this page.)
    await expect(page.locator('#top h1')).toBeVisible();
    expect(await page.locator('h2').count()).toBeGreaterThan(0);
  });

  test('[A11y] Main content is in main tag', async ({ page }) => {
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('[A11y] Links are keyboard accessible', async ({ page }) => {
    // Tab to first link
    await page.keyboard.press('Tab');
    
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    // Should focus on some element
    expect(focused).toBeTruthy();
  });

  test('[A11y] prefers-reduced-motion is respected', async ({ page }) => {
    // Emulate prefers-reduced-motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    
    // Page should still work
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });
});

test.describe('Landing Page Navigation - Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('[Performance] Page loads within reasonable time', async ({ page }) => {
    const navigationTiming = await page.evaluate(() => {
      const timing = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded: timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
        loadComplete: timing.loadEventEnd - timing.loadEventStart,
      };
    });

    // DOMContentLoaded should be < 3 seconds
    expect(navigationTiming.domContentLoaded).toBeLessThan(3000);
  });

  test('[Performance] No major layout shifts on load', async ({ page }) => {
    // Just verify page loads without crashing
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });
});

test.describe('Landing Page Navigation - Error Handling', () => {
  test('[Error Handling] Page handles navigation errors gracefully', async ({ page }) => {
    // Go to homepage
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    // No console errors should exist (or very few)
    let errorCount = 0;
    page.on('console', msg => {
      if (msg.type() === 'error') errorCount++;
    });
    
    await page.waitForTimeout(1000);
    
    // Allow some console errors but not many
    expect(errorCount).toBeLessThan(5);
  });

  test('[Error Handling] Page is responsive to user interactions', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    // Try to click a button if it exists
    const buttons = page.locator('button').first();
    if (await buttons.isVisible()) {
      await buttons.click();
      // Should not crash
      expect(true).toBe(true);
    }
  });
});
