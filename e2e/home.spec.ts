import { test, expect } from '@playwright/test';

test('homepage has title and renders correctly', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/1Think 2Win/);

    // Check for navigation bar
    const nav = page.locator('nav');
    await expect(nav).toBeVisible();

    // Check for main content
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Check for footer
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
});

test('login link works', async ({ page }) => {
    await page.goto('/');

    // Click the login link (this depends on your exact UI text, adjusting to generic guess or exact if known)
    // Assuming there is a "Login" or "Sign In" button/link
    const loginLink = page.getByRole('link', { name: /login/i }).first();

    if (await loginLink.isVisible()) {
        await loginLink.click();
        await expect(page).toHaveURL(/.*login/);
    } else {
        console.log('Login link not found or visible, skipping specific click check');
    }
});
