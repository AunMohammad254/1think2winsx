import { test, expect } from '@playwright/test';

test.skip('auth pages redirect and load correctly', async ({ page }) => {
    // Check login redirection
    await page.goto('/login');
    await expect(page).toHaveURL(/.*auth/);

    // Wait for the auth container to be visible (handles Suspense loading)
    // The sign in button is a good indicator of interactable state
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10000 });

    // Check register redirection
    await page.goto('/register');
    await expect(page).toHaveURL(/.*auth/);
    await expect(page.getByRole('button', { name: 'Sign Up' })).toBeVisible({ timeout: 10000 });
});
