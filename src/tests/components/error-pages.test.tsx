import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: (...a: unknown[]) => h.captureException(...a) }));

import NotFound, { metadata } from '@/app/not-found';
import RootError from '@/app/error';
import AppErrorView from '@/components/errors/AppErrorView';
import PageErrorHint from '@/components/errors/PageErrorHint';
import PrizesError from '@/app/prizes/error';

const chunkError = () => Object.assign(new Error('Loading chunk 9 failed.'), { name: 'ChunkLoadError' });
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.captureException.mockReset();
  reload = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);
});
afterEach(() => vi.restoreAllMocks());

const offline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

describe('404 page', () => {
  it('says the page is missing and links to quizzes and home', () => {
    render(<NotFound />);
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse quizzes/ })).toHaveAttribute('href', '/quizzes');
    expect(screen.getByRole('link', { name: /Go Home/ })).toHaveAttribute('href', '/');
    expect(metadata.title).toBe('Page not found | 1Think 2Win');
  });
});

describe('root error page', () => {
  it('reports to Sentry and retries an ordinary crash, showing the error ID', () => {
    const retry = vi.fn();
    const error = Object.assign(new Error('boom'), { digest: 'd42' });
    render(<RootError error={error} retry={retry} />);
    expect(h.captureException).toHaveBeenCalledWith(error, { tags: { page: 'root' } });
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText('Error ID: d42')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(retry).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('asks for the internet when offline', () => {
    offline();
    const retry = vi.fn();
    render(<AppErrorView error={null} retry={retry} />);
    expect(screen.getByRole('heading', { name: 'No internet connection' })).toBeInTheDocument();
    expect(screen.queryByText(/Error ID/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(retry).toHaveBeenCalled();
  });

  it('reloads the whole page when a file from an old deploy is missing', () => {
    const retry = vi.fn();
    render(<AppErrorView error={chunkError()} retry={retry} />);
    expect(screen.getByRole('heading', { name: 'A new version is available' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reload page/ }));
    expect(reload).toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('PageErrorHint', () => {
  it('adds nothing for an ordinary crash', () => {
    const { container } = render(<PageErrorHint error={new Error('db down')} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('points at the connection when offline', () => {
    offline();
    render(<PageErrorHint error={new Error('Failed to fetch')} />);
    expect(screen.getByRole('alert')).toHaveTextContent("You're offline.");
  });

  it('offers a reload after a deploy, inside a page error screen', () => {
    render(<PrizesError error={chunkError()} reset={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The site was just updated.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload the page' }));
    expect(reload).toHaveBeenCalled();
  });
});
