// Stands in for the Turnstile widget (jsdom never loads Cloudflare's script). It passes
// `turnstile.token` to the form on mount and again after every reset, and counts the resets so a
// test can check that a used token is replaced. Set `turnstile.token = null` for a check that has
// not passed yet.
//
//   vi.mock('@/components/auth/TurnstileWidget', async () => ({
//     default: (await import('@/tests/helpers/turnstile-mock')).TurnstileMock,
//   }));
import { forwardRef, useImperativeHandle, useLayoutEffect } from 'react';

export const turnstile = { token: 'captcha-token' as string | null, resets: 0 };

export function resetTurnstileMock() {
  turnstile.token = 'captcha-token';
  turnstile.resets = 0;
}

export const TurnstileMock = forwardRef<{ reset(): void }, { action: string; onToken(token: string | null): void }>(
  function TurnstileMock({ action, onToken }, ref) {
    // Once on mount, like the real widget's first pass. A layout effect runs in the same commit
    // that shows the form, so a test that finds the form never sees a submit still waiting.
    useLayoutEffect(() => {
      onToken(turnstile.token);
    }, []);
    useImperativeHandle(ref, () => ({
      reset() {
        turnstile.resets++;
        onToken(turnstile.token);
      },
    }));
    return <div data-testid={`turnstile-${action}`} />;
  }
);
