// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createServerClient } from '@supabase/ssr';
import {
  buildSessionCookieHeader,
  projectRefFromUrl,
  sessionCookieName,
} from '../../../load-test/lib/session-cookie';

const SUPABASE_URL = 'https://abcd1234.supabase.co';

// A session big enough to force cookie chunking, like a real one with user metadata
const session = {
  access_token: 'h.' + 'p'.repeat(1_800) + '.s',
  refresh_token: 'r'.repeat(12),
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: '11111111-2222-3333-4444-555555555555',
    email: 'loadtest+1@example.test',
    user_metadata: { name: 'Load Test', bio: 'x'.repeat(1_500) },
  },
};

describe('load-test session cookie', () => {
  it('derives the cookie name the app reads', () => {
    expect(projectRefFromUrl(SUPABASE_URL)).toBe('abcd1234');
    expect(sessionCookieName('abcd1234')).toBe('sb-abcd1234-auth-token');
  });

  it('splits an oversized session into numbered chunks', () => {
    const header = buildSessionCookieHeader('abcd1234', session);
    const names = header.split('; ').map((c) => c.split('=')[0]);
    expect(names.length).toBeGreaterThan(1);
    expect(names).toEqual(names.map((_, i) => `sb-abcd1234-auth-token.${i}`));
    for (const part of header.split('; ')) expect(part.length).toBeLessThan(3_300);
  });

  it('round-trips through the SAME @supabase/ssr client the app uses to read it', async () => {
    const header = buildSessionCookieHeader('abcd1234', session);
    const cookies = header.split('; ').map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1) };
    });

    const supabase = createServerClient(SUPABASE_URL, 'anon-key', {
      cookies: { getAll: () => cookies, setAll: () => {} },
    });
    const { data, error } = await supabase.auth.getSession();

    expect(error).toBeNull();
    expect(data.session?.access_token).toBe(session.access_token);
    expect(data.session?.refresh_token).toBe(session.refresh_token);
  });
});
