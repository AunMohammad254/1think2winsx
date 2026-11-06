import '@/tests/helpers/ui';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DeliveryPad from '@/components/admin/matches/DeliveryPad';
import type { ViewBall } from '@/lib/match-service';

function setup(props: { initial?: Pick<ViewBall, 'extra' | 'wicket' | 'wicketKind'>; label?: string; saved?: boolean; busy?: boolean } = {}) {
  const onRecord = vi.fn(async () => props.saved ?? true);
  render(<DeliveryPad busy={props.busy ?? false} onRecord={onRecord} initial={props.initial} label={props.label ?? ''} />);
  return onRecord;
}
const tap = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;

describe('DeliveryPad', () => {
  it('records runs in one tap: dots and singles, FOUR and SIX as boundaries, 4 ran and 6 ran as runs completed or overthrows', async () => {
    const onRecord = setup();
    for (const [name, delivery] of [
      ['0 runs', { runs: 0, extra: 'none', wicket: false }],
      ['3 runs', { runs: 3, extra: 'none', wicket: false }],
      ['Four', { runs: 4, extra: 'none', wicket: false, boundary: true }],
      ['Six', { runs: 6, extra: 'none', wicket: false, boundary: true }],
      ['4 runs, ran', { runs: 4, extra: 'none', wicket: false, boundary: false }],
      ['5 runs', { runs: 5, extra: 'none', wicket: false }],
      ['6 runs, ran', { runs: 6, extra: 'none', wicket: false, boundary: false }],
      ['7 runs', { runs: 7, extra: 'none', wicket: false }],
    ] as const) {
      tap(name);
      await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith(delivery));
    }
  });

  it('records extras: a wide, boundary byes, and a no-ball off the bat or with byes; nothing a delivery can\'t have', async () => {
    const onRecord = setup();
    tap('Wide');
    // Only a hit goes for six; no one is out LBW off a wide
    expect(disabled('Six')).toBe(true);
    expect(disabled('LBW')).toBe(true);
    expect(disabled('Stumped')).toBe(false);
    tap('Four');
    await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 4, extra: 'wide', wicket: false, boundary: true }));
    expect(pressed('Normal')).toBe('true');

    tap('Leg bye');
    tap('2 runs');
    await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 2, extra: 'leg_bye', wicket: false }));

    tap('No-ball');
    const runsFrom = screen.getByRole('group', { name: 'No-ball runs' });
    expect(within(runsFrom).getByRole('button', { name: 'Off the bat' })).toHaveAttribute('aria-pressed', 'true');
    expect(disabled('Caught')).toBe(true);
    tap('Six');
    await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 6, extra: 'no_ball', wicket: false, boundary: true }));
    expect(screen.queryByRole('group', { name: 'No-ball runs' })).toBeNull();

    tap('No-ball');
    tap('Byes');
    expect(pressed('Byes')).toBe('true');
    tap('1 run');
    await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 1, extra: 'no_ball_bye', wicket: false }));
    tap('No-ball');
    tap('Leg byes');
    tap('2 runs');
    await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 2, extra: 'no_ball_leg_bye', wicket: false }));
  });

  it('records a dismissal with no runs in one tap, and a run out with the runs completed', async () => {
    const onRecord = setup();
    for (const [name, wicketKind] of [['Bowled', 'bowled'], ['LBW', 'lbw'], ['Hit wicket', 'hit_wicket'], ['Hit twice', 'hit_twice']] as const) {
      tap(name);
      await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 0, extra: 'none', wicket: true, wicketKind }));
    }
    tap('Run out');
    expect(pressed('Run out')).toBe('true');
    expect(screen.getByRole('status')).toHaveTextContent('Run out: now tap the runs completed before it (0 if none).');
    // A boundary and a wicket can't be the same ball
    expect(disabled('Four')).toBe(true);
    // Tapped again: not out after all
    tap('Run out');
    expect(screen.queryByRole('status')).toBeNull();
    tap('Obstructing');
    expect(screen.getByRole('status')).toHaveTextContent('Obstructing the field: now tap the runs completed');
    tap('1 run');
    await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 1, extra: 'none', wicket: true, wicketKind: 'obstructing' }));
    // A stumping off a wide
    tap('Wide');
    tap('Stumped');
    await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 0, extra: 'wide', wicket: true, wicketKind: 'stumped' }));
  });

  it('records penalty runs, retired out and timed out, none of them a ball', async () => {
    const onRecord = setup();
    tap('+5 penalty runs');
    await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 0, extra: 'penalty', wicket: false }));
    tap('Retired out');
    await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 0, extra: 'no_delivery', wicket: true, wicketKind: 'retired_out' }));
    tap('Timed out');
    await waitFor(() => expect(onRecord).toHaveBeenLastCalledWith({ runs: 0, extra: 'no_delivery', wicket: true, wicketKind: 'timed_out' }));
  });

  it("keeps the choices when it wasn't saved, to try again", async () => {
    const onRecord = setup({ saved: false });
    tap('Bye');
    tap('Run out');
    tap('2 runs');
    await waitFor(() => expect(onRecord).toHaveBeenCalled());
    expect(pressed('Bye')).toBe('true');
    expect(pressed('Run out')).toBe('true');
  });

  it('starts a correction from what was recorded, every button named for it', () => {
    setup({ initial: { extra: 'no_ball_leg_bye', wicket: true, wicketKind: 'run_out' }, label: ' (correction)' });
    expect(pressed('No-ball')).toBe('true');
    expect(pressed('Leg byes')).toBe('true');
    expect(pressed('Run out (correction)')).toBe('true');
    expect(screen.getByRole('button', { name: '+5 penalty runs (correction)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retired out (correction)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Timed out (correction)' })).toBeInTheDocument();
  });

  it('starts from a normal ball for penalty runs, a retirement or a plain wicket', () => {
    setup({ initial: { extra: 'penalty', wicket: false, wicketKind: null } });
    expect(pressed('Normal')).toBe('true');
    document.body.innerHTML = '';
    setup({ initial: { extra: 'wide', wicket: true, wicketKind: 'stumped' } });
    expect(pressed('Wide')).toBe('true');
    expect(pressed('Stumped')).toBe('false');
  });

  it('takes nothing while a change is on its way', () => {
    setup({ busy: true });
    expect(disabled('1 run')).toBe(true);
    expect(disabled('Caught')).toBe(true);
    expect(disabled('+5 penalty runs')).toBe(true);
  });
});
