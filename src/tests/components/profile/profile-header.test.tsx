import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

// Mock Next.js Link component to expose prefetch as a data attribute,
// similar to other tests in the project (e.g. link-prefetch.test.tsx)
vi.mock('next/link', () => ({
  default: ({ href, prefetch, children, ...rest }: ComponentProps<'a'> & { href: string; prefetch?: boolean | null }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>{children}</a>
  ),
}));

import ProfileHeader from '@/components/profile/ProfileHeader';

describe('ProfileHeader', () => {
  it('renders default title and back link to home', () => {
    render(<ProfileHeader />);

    // Check title
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Profile');

    // Check back link
    const backLink = screen.getByLabelText('Go back to home');
    expect(backLink).toHaveAttribute('href', '/');
    expect(backLink).toHaveAttribute('data-prefetch', 'false');

    // Check edit link
    const editLink = screen.getByRole('link', { name: 'Edit profile' });
    expect(editLink).toHaveAttribute('href', '/profile/edit');
    expect(editLink).toHaveAttribute('data-prefetch', 'false');
  });

  it('renders custom title and custom back link', () => {
    render(<ProfileHeader title="My Settings" backHref="/dashboard" />);

    // Check title
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My Settings');

    // Check back link
    const backLink = screen.getByLabelText('Go back to previous page');
    expect(backLink).toHaveAttribute('href', '/dashboard');
    expect(backLink).toHaveAttribute('data-prefetch', 'false');
  });
});
