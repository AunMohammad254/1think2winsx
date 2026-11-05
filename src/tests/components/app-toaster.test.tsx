import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';

vi.mock('sonner', () => ({ Toaster: (props: Record<string, unknown>) => <div data-testid="toaster" data-position={props.position} /> }));

import AppToaster from '@/components/AppToaster';

const setFullscreenElement = (el: Element | null) => {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
  act(() => void document.dispatchEvent(new Event('fullscreenchange')));
};

afterEach(() => {
  // @ts-expect-error test cleanup
  delete document.fullscreenElement;
  // @ts-expect-error test cleanup
  delete document.webkitFullscreenElement;
  document.body.innerHTML = '';
});

describe('AppToaster', () => {
  it('moves the toasts into whatever is fullscreen, so they still show there, and back after', () => {
    document.body.insertAdjacentHTML('beforeend', '<section id="stage"></section>');
    const stage = document.getElementById('stage')!;
    const { container, unmount } = render(<AppToaster />);
    expect(container.querySelector('[data-testid="toaster"]')).toHaveAttribute('data-position', 'top-right');

    setFullscreenElement(stage);
    expect(container.querySelector('[data-testid="toaster"]')).toBeNull();
    expect(stage.querySelector('[data-testid="toaster"]')).not.toBeNull();

    setFullscreenElement(null);
    expect(container.querySelector('[data-testid="toaster"]')).not.toBeNull();
    expect(stage.querySelector('[data-testid="toaster"]')).toBeNull();

    // Stops listening when the app unmounts
    unmount();
    setFullscreenElement(stage);
    expect(stage.querySelector('[data-testid="toaster"]')).toBeNull();
  });

  it('supports webkitFullscreenElement and webkitfullscreenchange events for Safari', () => {
    document.body.insertAdjacentHTML('beforeend', '<section id="safari-stage"></section>');
    const stage = document.getElementById('safari-stage')!;
    const { container, unmount } = render(<AppToaster />);

    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => stage });
    act(() => void document.dispatchEvent(new Event('webkitfullscreenchange')));

    expect(container.querySelector('[data-testid="toaster"]')).toBeNull();
    expect(stage.querySelector('[data-testid="toaster"]')).not.toBeNull();

    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, get: () => null });
    act(() => void document.dispatchEvent(new Event('webkitfullscreenchange')));

    expect(container.querySelector('[data-testid="toaster"]')).not.toBeNull();
    expect(stage.querySelector('[data-testid="toaster"]')).toBeNull();

    unmount();
  });

  it('detects an element with [data-stream-fullscreen] attribute on initial mount', () => {
    document.body.insertAdjacentHTML('beforeend', '<section id="custom-stage" data-stream-fullscreen="true"></section>');
    const stage = document.getElementById('custom-stage')!;
    const { container } = render(<AppToaster />);

    // Toaster should be inside the stage immediately upon mount
    expect(container.querySelector('[data-testid="toaster"]')).toBeNull();
    expect(stage.querySelector('[data-testid="toaster"]')).not.toBeNull();
  });
});
