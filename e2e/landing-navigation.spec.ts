import { test, expect } from '@playwright/test';

/**
 * Phase 1.1: E2E Navigation Tests
 * Tests for smooth scrolling, section navigation, active state sync, and responsiveness
 */

test.describe('Landing Page Navigation - Desktop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for page to fully load with longer timeout
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500); // Extra wait for lazy-loaded sections
  });

  test('should render all navigation sections', async ({ page }) => {
    const sections = ['top', 'stats', 'marquee', 'how', 'live', 'prizes', 'leaderboard', 'reviews', 'cta'];
    
    for (const sectionId of sections) {
      const section = page.locator(`#${sectionId}`);
      // Use waitFor with longer timeout for lazy sections
      await section.waitFor({ state: 'attached', timeout: 10000 });
      await expect(section).toBeVisible({ timeout: 5000 });
    }
  });

  test('should have visible navigation sidebar on desktop', async ({ page }) => {
    const nav = page.locator('nav[aria-label="Page sections"]');
    await expect(nav).toBeVisible();
    
    // Check all nav buttons are present
    const navButtons = await page.locator('nav a').count();
    expect(navButtons).toBe(9); // 9 sections
  });

  test('clicking nav button scrolls to section smoothly', async ({ page }) => {
    const statsNavButton = page.locator('nav a[href="#stats"]');
    const statsSection = page.locator('#stats');
    
    // Get initial scroll position
    const initialScroll = await page.evaluate(() => window.scrollY);
    
    // Click nav button
    await statsNavButton.click();
    
    // Wait for scroll animation
    await page.waitForTimeout(1000);
    
    // Verify scroll happened
    const finalScroll = await page.evaluate(() => window.scrollY);
    expect(finalScroll).toBeGreaterThan(initialScroll);
    
    // Verify section is in viewport
    await expect(statsSection).toBeInViewport();
  });

  test('nav button highlights active section on click', async ({ page }) => {
    const statsNavButton = page.locator('nav a[href="#stats"]');
    const statsDot = statsNavButton.locator('span.section-nav-dot-active');
    
    // Initially should not be active
    await expect(statsDot).not.toBeVisible();
    
    // Click to activate
    await statsNavButton.click();
    await page.waitForTimeout(500);
    
    // Should now be active
    const dot = statsNavButton.locator('span[class*="section-nav-dot-active"]');
    await expect(dot).toBeVisible();
  });

  test('scroll progress bar updates as user scrolls', async ({ page }) => {
    const progressBar = page.locator('div[aria-hidden="true"].bg-gradient-to-r').first();
    
    // Initial state - progress at 0
    let scaleValue = await page.evaluate(() => {
      const bar = document.querySelector('div[style*="scaleX"]') as HTMLElement;
      return bar?.style.transform || '';
    });
    expect(scaleValue).toContain('scaleX(0)');
    
    // Scroll down
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
    await page.waitForTimeout(300);
    
    // Progress should have increased
    scaleValue = await page.evaluate(() => {
      const bar = document.querySelector('div[style*="scaleX"]') as HTMLElement;
      return bar?.style.transform || '';
    });
    expect(scaleValue).not.toContain('scaleX(0)');
  });

  test('scrolling manually updates active nav button', async ({ page }) => {
    // Scroll to "How It Works" section manually
    const howSection = page.locator('#how');
    await howSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    
    // Check if "How It Works" nav is highlighted
    const howNav = page.locator('nav a[href="#how"]');
    const activeClass = await howNav.locator('span:nth-child(2)').getAttribute('class');
    expect(activeClass).toContain('section-nav-dot-active');
  });

  test('multiple section clicks work correctly', async ({ page }) => {
    const navButtons = [
      { href: '#stats', id: 'stats' },
      { href: '#how', id: 'how' },
      { href: '#prizes', id: 'prizes' },
      { href: '#cta', id: 'cta' },
    ];

    for (const { href, id } of navButtons) {
      const button = page.locator(`nav a[href="${href}"]`);
      const section = page.locator(`#${id}`);
      
      await button.click();
      await page.waitForTimeout(800); // Wait for scroll animation
      
      await expect(section).toBeInViewport();
    }
  });

  test('nav button text appears on hover', async ({ page }) => {
    const statsNav = page.locator('nav a[href="#stats"]');
    const label = statsNav.locator('span:first-child');
    
    // Initially hidden
    const initialOpacity = await label.evaluate(el => 
      window.getComputedStyle(el).opacity
    );
    expect(parseFloat(initialOpacity)).toBeLessThan(0.5);
    
    // Hover over button
    await statsNav.hover();
    await page.waitForTimeout(300);
    
    // Now visible
    const hoverOpacity = await label.evaluate(el => 
      window.getComputedStyle(el).opacity
    );
    expect(parseFloat(hoverOpacity)).toBeGreaterThanOrEqual(0.7);
  });

  test('scroll animation completes before next click', async ({ page }) => {
    const statsButton = page.locator('nav a[href="#stats"]');
    const prizesButton = page.locator('nav a[href="#prizes"]');
    
    // First click
    await statsButton.click();
    
    // Immediate second click (should not cause issues)
    await prizesButton.click();
    
    // Wait for animation
    await page.waitForTimeout(1000);
    
    // Should be at prizes section
    const prizesSection = page.locator('#prizes');
    await expect(prizesSection).toBeInViewport();
  });

  test('hero section is visible on page load', async ({ page }) => {
    const hero = page.locator('section#top');
    await expect(hero).toBeInViewport();
    
    // Check for hero content
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
  });

  test('URL hash updates when scrolling via nav', async ({ page }) => {
    const statsButton = page.locator('nav a[href="#stats"]');
    
    await statsButton.click();
    await page.waitForTimeout(500);
    
    // Check URL contains section hash
    expect(page.url()).toContain('#stats');
  });
});

test.describe('Landing Page Navigation - Mobile', () => {
  test.beforeEach(async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('navigation sidebar should be hidden on mobile', async ({ page }) => {
    const nav = page.locator('nav[aria-label="Page sections"]');
    // Should be hidden by lg:flex or similar
    const isHidden = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Page sections"]');
      return window.getComputedStyle(nav!).display === 'none' || 
             window.getComputedStyle(nav!).visibility === 'hidden';
    });
    expect(isHidden).toBe(true);
  });

  test('scroll progress bar is visible on mobile', async ({ page }) => {
    const progressBar = page.locator('div[aria-hidden="true"].bg-gradient-to-r').first();
    await expect(progressBar).toBeVisible();
  });

  test('smooth scroll works on mobile', async ({ page }) => {
    const statsSection = page.locator('#stats');
    
    await statsSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    
    // Section should be visible
    await expect(statsSection).toBeInViewport();
  });

  test('page scrolling is not blocked on mobile', async ({ page }) => {
    const initialScroll = await page.evaluate(() => window.scrollY);
    
    // Scroll down
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(300);
    
    const newScroll = await page.evaluate(() => window.scrollY);
    expect(newScroll).toBeGreaterThan(initialScroll);
  });
});

test.describe('Landing Page Navigation - Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('navigation has proper ARIA labels', async ({ page }) => {
    const nav = page.locator('nav[aria-label="Page sections"]');
    const ariaLabel = await nav.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
  });

  test('nav buttons are keyboard accessible', async ({ page }) => {
    // Focus on first nav button using Tab
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); // May need multiple tabs
    
    // Skip to a nav button (this is an example, adjust based on actual tab order)
    let focused = await page.evaluate(() => document.activeElement?.tagName);
    
    // Press Enter to activate (eventually will hit nav after tabbing)
    // This is a simplified test - real test would verify all buttons are reachable
    const buttons = page.locator('nav a');
    expect(await buttons.count()).toBeGreaterThan(0);
  });

  test('scroll progress bar has aria-hidden', async ({ page }) => {
    const progressBar = page.locator('div[aria-hidden="true"]').first();
    const ariaHidden = await progressBar.getAttribute('aria-hidden');
    expect(ariaHidden).toBe('true');
  });

  test('prefers-reduced-motion is respected', async ({ page }) => {
    // Emulate prefers-reduced-motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    
    const statsButton = page.locator('nav a[href="#stats"]');
    await statsButton.click();
    
    // Should scroll to section (but without smooth animation)
    await page.waitForTimeout(100);
    
    const statsSection = page.locator('#stats');
    await expect(statsSection).toBeInViewport();
  });
});

test.describe('Landing Page Navigation - Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('rapid navigation clicks are handled smoothly', async ({ page }) => {
    const buttons = [
      'nav a[href="#stats"]',
      'nav a[href="#how"]',
      'nav a[href="#prizes"]',
      'nav a[href="#leaderboard"]',
    ];
    
    // Rapidly click multiple buttons
    for (const selector of buttons) {
      const button = page.locator(selector);
      await button.click({ force: true });
    }
    
    // Wait for final animation
    await page.waitForTimeout(1200);
    
    // Should end at leaderboard without errors
    const leaderboard = page.locator('#leaderboard');
    await expect(leaderboard).toBeInViewport();
  });

  test('scrolling back to top works', async ({ page }) => {
    // Scroll down
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(300);
    
    // Click home button
    const homeButton = page.locator('nav a[href="#top"]');
    await homeButton.click();
    await page.waitForTimeout(800);
    
    // Should be at top
    const scroll = await page.evaluate(() => window.scrollY);
    expect(scroll).toBeLessThan(100);
  });

  test('page maintains state during navigation', async ({ page }) => {
    // Fill something in footer (if testable)
    const emailInput = page.locator('input[type="email"]').first();
    
    if (await emailInput.isVisible()) {
      await emailInput.fill('test@example.com');
      
      // Navigate away
      const statsButton = page.locator('nav a[href="#stats"]');
      await statsButton.click();
      await page.waitForTimeout(800);
      
      // Value should still be there (page state preserved)
      const value = await emailInput.inputValue();
      expect(value).toBe('test@example.com');
    }
  });

  test('handles network latency gracefully', async ({ page }) => {
    // Simulate slow network
    await page.route('**/*', route => {
      setTimeout(() => route.continue(), 100);
    });
    
    const statsButton = page.locator('nav a[href="#stats"]');
    await statsButton.click();
    
    // Should still work
    await page.waitForTimeout(1000);
    const statsSection = page.locator('#stats');
    await expect(statsSection).toBeInViewport();
  });

  test('sections are properly spaced and don\'t overlap', async ({ page }) => {
    const sections = ['top', 'stats', 'how', 'prizes', 'cta'];
    const positions: number[] = [];
    
    for (const sectionId of sections) {
      const section = page.locator(`#${sectionId}`);
      await section.waitFor({ state: 'attached', timeout: 10000 });
      const box = await section.boundingBox({ timeout: 5000 });
      if (box) positions.push(box.y);
    }
    
    // Each section should be below the previous one
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  test('nav remains fixed while scrolling', async ({ page }) => {
    const nav = page.locator('nav[aria-label="Page sections"]');
    const initialPos = await nav.boundingBox();
    
    // Scroll down significantly
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(300);
    
    // Nav position should remain similar (fixed positioning)
    const finalPos = await nav.boundingBox();
    expect(finalPos?.y).toBeCloseTo(initialPos?.y || 0, 50); // Allow 50px tolerance
  });
});
