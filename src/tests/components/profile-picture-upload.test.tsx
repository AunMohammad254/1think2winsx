import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProfilePictureUpload from '@/components/ProfilePictureUpload';

// Mock Next.js Image component
vi.mock('next/image', () => ({
  default: (props: any) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

describe('ProfilePictureUpload Component', () => {
  const mockOnImageUpload = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders default state correctly (placeholder "?")', () => {
    render(<ProfilePictureUpload onImageUpload={mockOnImageUpload} />);

    expect(screen.getByText('?')).toBeInTheDocument();
    expect(screen.getByText('Click to upload')).toBeInTheDocument();
    expect(screen.getByText('PNG, JPG, WebP or GIF up to 5MB')).toBeInTheDocument();
  });

  it('renders with existing currentImage', () => {
    const imageUrl = 'https://example.com/avatar.jpg';
    render(<ProfilePictureUpload onImageUpload={mockOnImageUpload} currentImage={imageUrl} />);

    const image = screen.getByAltText('Profile picture');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', imageUrl);
  });

  it('renders loading overlay when loading is true', () => {
    const { container } = render(<ProfilePictureUpload onImageUpload={mockOnImageUpload} loading={true} />);

    // Check for the animate-spin div which indicates loading
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();

    // Check if input is disabled
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('handles valid file upload via input change', async () => {
    const file = new File(['dummy content'], 'avatar.jpg', { type: 'image/jpeg' });
    render(<ProfilePictureUpload onImageUpload={mockOnImageUpload.mockResolvedValue(undefined)} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockOnImageUpload).toHaveBeenCalledWith(file);
    });
  });

  it('rejects invalid file type', async () => {
    const file = new File(['dummy content'], 'document.pdf', { type: 'application/pdf' });
    render(<ProfilePictureUpload onImageUpload={mockOnImageUpload} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(window.alert).toHaveBeenCalledWith('Please select a valid image file (JPEG, PNG, WebP, or GIF)');
    expect(mockOnImageUpload).not.toHaveBeenCalled();
  });

  it('rejects file larger than 5MB', async () => {
    const largeFile = new File(['dummy content'], 'large.jpg', { type: 'image/jpeg' });
    Object.defineProperty(largeFile, 'size', { value: 6 * 1024 * 1024 }); // 6MB

    render(<ProfilePictureUpload onImageUpload={mockOnImageUpload} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [largeFile] } });

    expect(window.alert).toHaveBeenCalledWith('File size must be less than 5MB');
    expect(mockOnImageUpload).not.toHaveBeenCalled();
  });

  it('handles drag and drop correctly', async () => {
    render(<ProfilePictureUpload onImageUpload={mockOnImageUpload.mockResolvedValue(undefined)} />);

    // Find the dropzone container
    const dropzone = screen.getByText('Click to upload').closest('div.relative.border-2');
    expect(dropzone).toBeInTheDocument();

    // Test drag enter
    fireEvent.dragEnter(dropzone!);
    expect(dropzone).toHaveClass('border-green-500');

    // Test drag leave
    fireEvent.dragLeave(dropzone!);
    expect(dropzone).toHaveClass('border-gray-300');

    // Test drop with a valid file
    const file = new File(['dummy content'], 'dragged.jpg', { type: 'image/jpeg' });
    fireEvent.drop(dropzone!, {
      dataTransfer: { files: [file] }
    });

    await waitFor(() => {
      expect(mockOnImageUpload).toHaveBeenCalledWith(file);
    });
  });

  it('handles upload failure properly', async () => {
    const error = new Error('Upload failed');
    mockOnImageUpload.mockRejectedValueOnce(error);

    const file = new File(['dummy content'], 'avatar.jpg', { type: 'image/jpeg' });
    render(<ProfilePictureUpload onImageUpload={mockOnImageUpload} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockOnImageUpload).toHaveBeenCalledWith(file);
    });

    expect(console.error).toHaveBeenCalledWith('Upload failed:', error);

    // Preview should be cleared, fallback to placeholder '?'
    await waitFor(() => {
        expect(screen.getByText('?')).toBeInTheDocument();
    });
  });

  it('triggers input click when upload area is clicked', () => {
    render(<ProfilePictureUpload onImageUpload={mockOnImageUpload} />);

    const dropzone = screen.getByText('Click to upload').closest('div.relative.border-2');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    const clickSpy = vi.spyOn(input, 'click');

    fireEvent.click(dropzone!);

    expect(clickSpy).toHaveBeenCalled();
  });
});
