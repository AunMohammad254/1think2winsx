import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileAvatar from '@/components/profile/ProfileAvatar';

describe('ProfileAvatar', () => {
    it('renders an image when imageSrc is provided', () => {
        render(<ProfileAvatar name="Test User" imageSrc="/test-image.jpg" />);
        // Next.js might render multiple img tags depending on configuration or structure.
        // We'll search within the component container or find the img with alt text.
        const img = screen.getByAltText('Test User');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src');
    });

    it('renders initials when imageSrc is missing', () => {
        render(<ProfileAvatar name="John Doe" />);
        const initials = screen.getByText('JD');
        expect(initials).toBeInTheDocument();
        // Since there is no imageSrc, there should be no element with alt text of the user
        expect(screen.queryByAltText('John Doe')).not.toBeInTheDocument();
    });

    it('handles single name for initials correctly', () => {
        render(<ProfileAvatar name="Admin" />);
        const initials = screen.getByText('A'); // getInitials returns just 'A' for 'Admin'
        expect(initials).toBeInTheDocument();
    });

    it('renders userId when provided', () => {
        render(<ProfileAvatar name="User" userId="user123" />);
        const userIdText = screen.getByText('@user123');
        expect(userIdText).toBeInTheDocument();
    });

    it('renders as a button with camera icon when onClick is provided', () => {
        const onClick = vi.fn();
        render(<ProfileAvatar name="User" onClick={onClick} />);

        const button = screen.getByRole('button', { name: 'Update profile picture' });
        expect(button).toBeInTheDocument();

        // Ensure there is no div with role='img' since it should be wrapped in button
        const circles = screen.queryAllByRole('img');
        expect(circles).toHaveLength(0); // If it still renders role=img on inner we could check, but the component conditionally removes it: role={onClick ? undefined : 'img'}
    });

    it('fires onClick when clicked', () => {
        const onClick = vi.fn();
        render(<ProfileAvatar name="User" onClick={onClick} />);

        const button = screen.getByRole('button', { name: 'Update profile picture' });
        fireEvent.click(button);

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('applies correct sizing classes based on size prop', () => {
        // sm
        const { unmount } = render(<ProfileAvatar name="User" size="sm" />);
        const smInitials = screen.getByText('U');
        expect(smInitials).toHaveClass('text-xl');
        unmount();

        // md
        render(<ProfileAvatar name="User" size="md" />);
        const mdInitials = screen.getByText('U');
        expect(mdInitials).toHaveClass('text-2xl');
    });
});
