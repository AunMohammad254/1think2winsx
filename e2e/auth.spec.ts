import { test, expect } from '@playwright/test';

// The auth page has "Sign In" / "Sign Up" toggle buttons above the form, so each
// check looks inside the form to avoid matching the toggle as well.
test('login and register open the auth page with the right form', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/auth\?mode=login$/);
    // Wait for the form to mount (the page renders inside Suspense)
    await expect(page.locator('form').getByRole('button', { name: 'Sign In', exact: true })).toBeVisible({ timeout: 10000 });

    await page.goto('/register');
    await expect(page).toHaveURL(/\/auth\?mode=register$/);
    await expect(page.locator('form').getByRole('button', { name: 'Create Account', exact: true })).toBeVisible({ timeout: 10000 });
});

test('the toggle switches between the sign-in and sign-up forms', async ({ page }) => {
    await page.goto('/auth?mode=login');
    const form = page.locator('form');
    await expect(form.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
    await expect(form.getByRole('button', { name: 'Create Account', exact: true })).toBeVisible({ timeout: 10000 });

    // Only the toggle matches here: the register form's own link reads "Sign in"
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(form.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible({ timeout: 10000 });
});
