import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const auth = vi.hoisted(() => ({ value: { user: null as Record<string, unknown> | null, isLoading: false } }));
const getCSRFToken = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => getCSRFToken() }));

import { ProfileProvider, useProfile } from '@/contexts/ProfileContext';

const wrapper = ({ children }: { children: ReactNode }) => <ProfileProvider>{children}</ProfileProvider>;
const user = { id: 'u1', email: 'ali@example.test', created_at: '2026-01-01', user_metadata: { name: 'Ali', avatar_url: 'https://img/a.png' } };
const apiProfile = {
  user: { id: 'u1', name: 'Ali', email: 'ali@example.test', profilePicture: null, createdAt: 'c', points: 40, walletBalance: null, totalQuizAttempts: 3, totalWinnings: 2 },
  quizHistory: [
    { id: 'a1', score: 80, answers: [{ isCorrect: true }, { isCorrect: true }, { isCorrect: false }] },
    { id: 'a2', score: 50, answers: [{ isCorrect: true }] },
  ],
  recentWinnings: [{ id: 'w1', prize: { name: 'Watch', type: 'watch' }, dateWon: 'd', type: 'quiz_win', status: 'claimed' }],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  auth.value = { user, isLoading: false };
  fetchMock = vi.fn().mockResolvedValue(json(apiProfile));
  vi.stubGlobal('fetch', fetchMock);
  getCSRFToken.mockReset().mockResolvedValue('tok');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProfileProvider', () => {
  it('fetches nothing until a component asks for the profile', () => {
    render(<ProfileProvider><div /></ProfileProvider>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads and maps the profile with stats when useProfile is used', async () => {
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('/api/profile');
    expect(result.current.profile).toMatchObject({
      id: 'u1', points: 40, walletBalance: 0, quizzesTaken: 3, winCount: 2, totalScore: 130, correctAnswers: 3,
      prizes: [{ id: 'w1', name: 'Watch', image: '/watch.svg', dateWon: 'd', type: 'quiz_win', status: 'claimed' }],
    });
  });

  it('maps an empty API profile with defaults', async () => {
    fetchMock.mockResolvedValue(json({ user: { id: 'u1', name: 'A', email: 'e' } }));
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toMatchObject({ points: 0, quizzesTaken: 0, winCount: 0, quizHistory: [], prizes: [], totalScore: 0 });
  });

  it('falls back to the Supabase user when the API refuses or fails', async () => {
    fetchMock.mockResolvedValue(json({}, 500));
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toMatchObject({ id: 'u1', name: 'Ali', profilePicture: 'https://img/a.png', points: 0 });
    expect(result.current.error).toBeNull();

    auth.value = { user: { id: 'u2', email: 'sara@example.test', user_metadata: { full_name: 'Sara F' } }, isLoading: false };
    fetchMock.mockRejectedValue(new Error('offline'));
    const second = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.profile).toMatchObject({ name: 'Sara F', profilePicture: null });
    expect(second.result.current.error).toBe('Failed to load profile data');
  });

  it('derives a name from the email, or "User", in the fallback', async () => {
    fetchMock.mockResolvedValue(json({}, 401));
    auth.value = { user: { id: 'u3', email: 'kamran@example.test', user_metadata: {} }, isLoading: false };
    let hook = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.profile).toMatchObject({ name: 'kamran', email: 'kamran@example.test' });

    auth.value = { user: { id: 'u4', user_metadata: {} }, isLoading: false };
    hook = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.profile).toMatchObject({ name: 'User', email: 'user@example.com' });

    fetchMock.mockRejectedValue(new Error('x'));
    hook = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.profile).toMatchObject({ name: 'User' });
    auth.value = { user: { id: 'u5', email: 'z@x', user_metadata: {} }, isLoading: false };
    hook = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.profile).toMatchObject({ name: 'z' });
  });

  it('waits for auth, and clears the profile when signed out', async () => {
    auth.value = { user: null, isLoading: true };
    const { result, rerender } = renderHook(() => useProfile(), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
    auth.value = { user: null, isLoading: false };
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();
  });

  it('updates the profile with the CSRF token and merges the result', async () => {
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock.mockResolvedValueOnce(json({ user: { name: 'New Name', email: 'new@x' } }));
    await act(() => result.current.updateProfile({ name: 'New Name', email: 'new@x' }));
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/profile/update');
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    expect(result.current.profile).toMatchObject({ name: 'New Name', email: 'new@x', points: 40 });
  });

  it('reports update failures and rethrows them', async () => {
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    getCSRFToken.mockResolvedValue(null);
    for (const [body, message] of [[{ error: 'Email already in use' }, 'Email already in use'], [{ message: 'Invalid input' }, 'Invalid input'], [{}, 'Failed to update profile']] as const) {
      fetchMock.mockResolvedValueOnce(json(body, 400));
      await act(async () => { await expect(result.current.updateProfile({ name: 'x', email: 'y' })).rejects.toThrow(message); });
      expect(result.current.error).toBe(message);
    }
    expect(fetchMock.mock.calls.at(-1)![1].headers['X-CSRF-Token']).toBe('');
    getCSRFToken.mockRejectedValueOnce('odd');
    await act(async () => { await expect(result.current.updateProfile({ name: 'x', email: 'y' })).rejects.toBe('odd'); });
    expect(result.current.error).toBe('Failed to update profile');
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('uploads a profile picture and stores the new URL', async () => {
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock.mockResolvedValueOnce(json({ imageUrl: 'https://cdn/new.avif' }));
    await act(() => result.current.uploadProfilePicture(new File(['x'], 'me.png', { type: 'image/png' })));
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect((init.body as FormData).get('profilePicture')).toBeInstanceOf(File);
    expect(result.current.profile?.profilePicture).toBe('https://cdn/new.avif');

    fetchMock.mockResolvedValueOnce(json({ message: 'Too large' }, 400));
    await act(async () => { await expect(result.current.uploadProfilePicture(new File(['x'], 'big.png'))).rejects.toThrow('Too large'); });
    fetchMock.mockResolvedValueOnce(json({}, 400));
    await act(async () => { await expect(result.current.uploadProfilePicture(new File(['x'], 'big.png'))).rejects.toThrow('Failed to upload profile picture'); });
    getCSRFToken.mockRejectedValueOnce('odd');
    await act(async () => { await expect(result.current.uploadProfilePicture(new File(['x'], 'a.png'))).rejects.toBe('odd'); });
    expect(result.current.error).toBe('Failed to upload profile picture');
  });

  it('update and upload before any profile exists, and refresh', async () => {
    auth.value = { user: null, isLoading: false };
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock.mockResolvedValueOnce(json({ user: { id: 'x', name: 'N' } }));
    await act(() => result.current.updateProfile({ name: 'N', email: 'e' }));
    expect(result.current.profile).toEqual({ id: 'x', name: 'N' });

    auth.value = { user: null, isLoading: false };
    const fresh = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(fresh.result.current.loading).toBe(false));
    fetchMock.mockResolvedValueOnce(json({ imageUrl: 'u' }));
    await act(() => fresh.result.current.uploadProfilePicture(new File(['x'], 'a.png')));
    expect(fresh.result.current.profile).toBeNull();

    auth.value = { user, isLoading: false };
    const r = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(r.result.current.loading).toBe(false));
    fetchMock.mockClear();
    await act(() => r.result.current.refreshProfile());
    expect(fetchMock).toHaveBeenCalledWith('/api/profile');
  });

  it('useProfile must be used inside the provider', () => {
    function Outside() {
      useProfile();
      return null;
    }
    expect(() => render(<Outside />)).toThrow('useProfile must be used within a ProfileProvider');
  });
});
