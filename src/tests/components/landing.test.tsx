import { jsonResponse } from '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { loadLiveSnapshot, resetLiveSnapshot } from '@/hooks/useLiveSnapshot';
import type { LiveQuiz as LiveQuizData, LiveSnapshot } from '@/lib/live-catalog';

const auth = vi.hoisted(() => ({ value: { user: null as { id: string } | null, isLoading: false } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }));

import {
  useScrollReveal, useCountUp, useParallaxPointer, useActiveSection, useTypewriter, useAnimatedCounter,
  Section, Eyebrow, Reveal, Button, Card, TrophyIcon, SectionHeading,
} from '@/components/landing/Primitives';
import ScrollProgress from '@/components/landing/ScrollProgress';
import Marquee from '@/components/landing/Marquee';
import { Particles, TypedTitle, HeroCTA } from '@/components/landing/HeroClient';
import Prizes from '@/components/landing/Prizes';
import HowItWorks from '@/components/landing/HowItWorks';
import SectionNav from '@/components/landing/SectionNav';
import Stats from '@/components/landing/Stats';
import CTA from '@/components/landing/CTA';
import Testimonials from '@/components/landing/Testimonials';
import Leaderboard from '@/components/landing/Leaderboard';
import Hero from '@/components/landing/Hero';
import LiveQuiz from '@/components/landing/LiveQuiz';

// ---- browser API fakes ---------------------------------------------------------------------
type IOCallback = (entries: { target: Element; isIntersecting: boolean }[]) => void;
let observers: FakeIO[] = [];
class FakeIO {
  nodes = new Set<Element>();
  observe = vi.fn((n: Element) => void this.nodes.add(n));
  unobserve = vi.fn((n: Element) => void this.nodes.delete(n));
  disconnect = vi.fn(() => this.nodes.clear());
  constructor(public cb: IOCallback) { observers.push(this); }
}
const intersect = (isIntersecting = true) =>
  act(() => observers.forEach((o) => o.cb([...o.nodes].map((target) => ({ target, isIntersecting })))));

// vitest.setup.ts defines these as writable but not configurable, so assign rather than stubGlobal.
const realIO = window.IntersectionObserver;
const realMatchMedia = window.matchMedia;
const media = (matching: string[] = []) => {
  window.matchMedia = vi.fn((q: string) => ({ matches: matching.includes(q), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
};
const REDUCED = '(prefers-reduced-motion: reduce)';
const COARSE = '(pointer: coarse)';

const frames = () => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
// jsdom has no layout, so scrollLeft writes are dropped: keep the value on the element.
const storeScrollLeft = (el: HTMLElement) => {
  let v = 0;
  Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => v, set: (n: number) => { v = n; } });
};

// The live quiz snapshot (GET /api/live): pending unless a test answers it, so sections show their
// static copy as they do while it loads
let fetchMock: ReturnType<typeof vi.fn>;
const liveQuiz = (id: string, over: Partial<LiveQuizData> = {}): LiveQuizData => ({
  id, title: `Quiz ${id}`, description: '', duration: 10, passingScore: 70, status: 'active', questionCount: 10,
  totalAttempts: 0, entriesClosed: false, pushedAt: null, startsAt: null, announcedAt: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  prizeName: null, isBumperPrize: false, accessPrice: 0, ...over,
});
/** Answers the snapshot before rendering, the way it arrives from Cloudflare's cache. */
const primeLive = async (quizzes: LiveQuizData[], walletEnabled = false) => {
  const snapshot: LiveSnapshot = { version: 'v1', quizzes, walletEnabled };
  fetchMock.mockImplementation(async () => jsonResponse(snapshot));
  await loadLiveSnapshot();
  // Later refreshes stay pending, so the clock alone drives what the test sees
  fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
};
// 12:00 UTC is 5:00 PM in Karachi
const NOW = new Date('2026-10-18T12:00:00.000Z');
const minutesFromNow = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

beforeEach(() => {
  observers = [];
  window.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;
  media();
  auth.value = { user: null, isLoading: false };
  resetLiveSnapshot();
  fetchMock = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  window.IntersectionObserver = realIO;
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---- Primitives: hooks -----------------------------------------------------------------------
describe('useScrollReveal', () => {
  function Probe({ once = true }: { once?: boolean }) {
    const { ref, isVisible } = useScrollReveal({ once });
    return <div ref={ref}>{isVisible ? 'shown' : 'hidden'}</div>;
  }

  it('reveals on intersection and stops watching when once', () => {
    render(<Probe />);
    expect(screen.getByText('hidden')).toBeInTheDocument();
    intersect(false);
    expect(screen.getByText('hidden')).toBeInTheDocument();
    intersect();
    expect(screen.getByText('shown')).toBeInTheDocument();
    expect(observers[0].unobserve).toHaveBeenCalled();
  });

  it('hides again when not once', () => {
    render(<Probe once={false} />);
    intersect();
    intersect(false);
    expect(screen.getByText('hidden')).toBeInTheDocument();
  });

  it('shows immediately with reduced motion, and copes with no node', () => {
    media([REDUCED]);
    render(<Probe />);
    expect(screen.getByText('shown')).toBeInTheDocument();
    expect(observers).toHaveLength(0);
    renderHook(() => useScrollReveal());
  });
});

describe('useCountUp and useAnimatedCounter', () => {
  function Count({ to, when = true }: { to: number; when?: boolean }) {
    const ref = useCountUp(to, 1000, when);
    return <span ref={ref as React.RefObject<HTMLSpanElement>}>0</span>;
  }

  it('counts up over the duration', () => {
    frames();
    const { container, unmount } = render(<Count to={12000} />);
    advance(500);
    const mid = Number(container.textContent!.replace(/,/g, ''));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(12000);
    advance(1000);
    expect(container.textContent).toBe('12,000');
    unmount();
  });

  it('waits for startWhen, and jumps straight there with reduced motion', () => {
    const { container, rerender } = render(<Count to={500} when={false} />);
    expect(container.textContent).toBe('0');
    media([REDUCED]);
    rerender(<Count to={500} when />);
    expect(container.textContent).toBe('500');
    renderHook(() => useCountUp(10));
  });

  it('useAnimatedCounter eases to the target, and ignores zero', () => {
    frames();
    const { result } = renderHook(({ t }) => useAnimatedCounter(t, 400), { initialProps: { t: 0 } });
    advance(500);
    expect(result.current).toBe(0);
    const { result: r2, unmount } = renderHook(() => useAnimatedCounter(300, 400));
    advance(100);
    expect(r2.current).toBeGreaterThan(0);
    advance(400);
    expect(r2.current).toBe(300);
    unmount();
  });
});

describe('useParallaxPointer', () => {
  function Parallax() {
    const ref = useParallaxPointer(10);
    return <div data-testid="wrap"><div data-testid="layer" ref={ref as React.RefObject<HTMLDivElement>} /></div>;
  }
  const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;

  it('moves the layer with the pointer and resets on leave', () => {
    frames();
    const { unmount } = render(<Parallax />);
    const layer = screen.getByTestId('layer');
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(rect);
    const wrap = screen.getByTestId('wrap');
    fireEvent.mouseMove(wrap, { clientX: 100, clientY: 0 }); // no mouseenter yet: measures lazily
    advance(20);
    expect(layer.style.transform).toBe('translate3d(5px, -5px, 0)');
    fireEvent.mouseLeave(wrap);
    expect(layer.style.transform).toBe('translate3d(0,0,0)');
    fireEvent.mouseEnter(wrap);
    fireEvent.mouseMove(wrap, { clientX: 50, clientY: 50 });
    advance(20);
    expect(layer.style.transform).toBe('translate3d(0px, 0px, 0)');
    unmount();
  });

  it('stays still on touch screens and with reduced motion', () => {
    for (const m of [[COARSE], [REDUCED]]) {
      media(m);
      const { unmount } = render(<Parallax />);
      fireEvent.mouseMove(screen.getByTestId('wrap'), { clientX: 100 });
      expect(screen.getByTestId('layer').style.transform).toBe('');
      unmount();
    }
    renderHook(() => useParallaxPointer());
  });
});

describe('useActiveSection', () => {
  it('tracks the section under the navbar as the page scrolls', () => {
    frames();
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const at = (id: string, top: number, bottom: number) =>
      vi.spyOn(document.getElementById(id)!, 'getBoundingClientRect').mockReturnValue({ top, bottom } as DOMRect);
    at('a', 0, 100);
    at('b', 100, 400);
    const { result, unmount } = renderHook(() => useActiveSection(['missing', 'a', 'b']));
    expect(result.current.activeId).toBe('b');
    at('b', 500, 900);
    act(() => void window.dispatchEvent(new Event('scroll')));
    advance(20);
    expect(result.current.activeId).toBe('missing');
    act(() => result.current.setActiveId('a'));
    expect(result.current.activeId).toBe('a');
    unmount();
    document.body.innerHTML = '';
  });
});

describe('useTypewriter', () => {
  it('types, pauses, deletes and moves to the next word', () => {
    frames();
    const { result } = renderHook(() => useTypewriter(['ab', 'cd'], { typeSpeed: 10, deleteSpeed: 10, pause: 100 }));
    expect(result.current).toBe('ab');
    advance(100);
    expect(result.current).toBe('a');
    advance(10);
    expect(result.current).toBe('');
    advance(10);
    expect(result.current).toBe('c');
    advance(10);
    expect(result.current).toBe('cd');
    advance(100);
    expect(result.current).toBe('c');
    renderHook(() => useTypewriter(['x']));
  });
});

// ---- Primitives: components ------------------------------------------------------------------
describe('landing primitives', () => {
  it('Section, Eyebrow, Card and TrophyIcon render with their options', () => {
    const { container } = render(
      <>
        <Section id="s" className="extra" containerClassName="inner">body</Section>
        <Eyebrow>pitch</Eyebrow>
        <Eyebrow tone="trophy">trophy</Eyebrow>
        <Eyebrow tone="live" className="x">live</Eyebrow>
        <Card glow="pitch">c1</Card>
        <Card glow="trophy" className="k">c2</Card>
        <Card>c3</Card>
        <TrophyIcon className="t" />
      </>,
    );
    expect(container.querySelector('section#s')!.className).toContain('extra');
    expect(screen.getByText('trophy').className).toContain('text-amber-300');
    expect(screen.getByText('live').querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.getByText('c1').className).toContain('hover:glow-pitch');
    expect(screen.getByText('c2').className).toContain('hover:glow-trophy');
    expect(container.querySelector('svg.t')).not.toBeNull();
  });

  it('Reveal picks its variant class and element', () => {
    render(
      <>
        <Reveal variant="left">l</Reveal>
        <Reveal variant="right">r</Reveal>
        <Reveal variant="scale" delay={50} as="section">s</Reveal>
        <Reveal variant="fade">f</Reveal>
      </>,
    );
    expect(screen.getByText('l').className).toContain('reveal-left');
    expect(screen.getByText('r').className).toContain('reveal-right');
    expect(screen.getByText('s').tagName).toBe('SECTION');
    expect(screen.getByText('s').style.transitionDelay).toBe('50ms');
    expect(screen.getByText('f').className).toBe('reveal');
  });

  it('Button is a Link, an anchor or a button', () => {
    const onClick = vi.fn();
    render(
      <>
        <Button href="/quizzes" icon={<i>→</i>}>Internal</Button>
        <Button href="#how" variant="secondary" size="sm">Anchor</Button>
        <Button onClick={onClick} variant="ghost" size="lg">Plain</Button>
        <Button href="https://x.test" variant="trophy">Ext</Button>
      </>,
    );
    expect(screen.getByRole('link', { name: /Internal/ })).toHaveAttribute('href', '/quizzes');
    expect(screen.getByRole('link', { name: 'Anchor' })).toHaveAttribute('href', '#how');
    fireEvent.click(screen.getByRole('button', { name: 'Plain' }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Ext' }).className).toContain('from-amber-400');
  });

  it('SectionHeading shows the optional eyebrow and description', () => {
    const { rerender } = render(<SectionHeading eyebrow="Eye" title="Title" description="Desc" align="left" tone="trophy" />);
    expect(screen.getByText('Eye')).toBeInTheDocument();
    expect(screen.getByText('Desc')).toBeInTheDocument();
    rerender(<SectionHeading title="Only title" />);
    expect(screen.queryByText('Eye')).toBeNull();
  });
});

// ---- landing sections ------------------------------------------------------------------------
describe('ScrollProgress', () => {
  it('scales the bar with the scroll position, once per frame', () => {
    frames();
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    const { container, unmount } = render(<ScrollProgress />);
    const bar = container.firstElementChild as HTMLElement;
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });
    act(() => { window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('scroll')); });
    advance(20);
    expect(bar.style.transform).toBe('scaleX(0.5)');
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 1000 });
    act(() => void window.dispatchEvent(new Event('scroll')));
    advance(20);
    expect(bar.style.transform).toBe('scaleX(0)');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    unmount();
    act(() => void window.dispatchEvent(new Event('scroll')));
    advance(20);
  });
});

describe('static landing sections', () => {
  it('Marquee repeats the partner list in two tracks', () => {
    render(<Marquee />);
    expect(screen.getAllByText('Squash')).toHaveLength(6);
    expect(screen.getByText('Quizzes on every sport Pakistan loves')).toBeInTheDocument();
  });

  it('HowItWorks lists the four steps', () => {
    render(<HowItWorks />);
    expect(screen.getByText('Create your account')).toBeInTheDocument();
    expect(screen.getByText('Streaks & Combos')).toBeInTheDocument();
  });

  it('Prizes send visitors to register and players to quizzes', () => {
    const { rerender } = render(<Prizes />);
    expect(screen.getByRole('link', { name: 'Enter Weekly' })).toHaveAttribute('href', '/register');
    auth.value = { user: { id: 'u' }, isLoading: false };
    rerender(<Prizes />);
    expect(screen.getByRole('link', { name: 'Enter Weekly' })).toHaveAttribute('href', '/quizzes');
  });

  it('Hero renders the typed title, call to action and demo card', () => {
    render(<Hero />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Test your Sports IQ');
    expect(screen.getByText('Imad Wasim')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scroll down' })).toHaveAttribute('href', '#stats');
  });
});

describe('landing copy', () => {
  it('is written for Pakistani fans, with no India-specific leftovers', () => {
    const { container } = render(
      <>
        <Hero /><Stats /><Marquee /><HowItWorks /><LiveQuiz /><Prizes /><Leaderboard /><Testimonials /><CTA />
      </>
    );
    expect(container.textContent).not.toMatch(/\b(IPL|India|Indian|IST|UPI|BCCI|Hotstar)\b/);
    // The weekly board is a rolling 7-day window (compute_leaderboard), not a Sunday reset
    expect(container.textContent).toContain('Weekly board counts the last 7 days');
    expect(container.textContent).toContain('Karachi Kings — PSL Ultimate Trivia');
  });
});

describe('HeroClient', () => {
  it('Particles appear after mount', () => {
    const { container } = render(<Particles />);
    expect(container.querySelectorAll('span.anim-particle')).toHaveLength(30);
  });

  it('TypedTitle types the first subhead', () => {
    render(<TypedTitle subheads={['One', 'Two']} />);
    expect(screen.getByText('One')).toBeInTheDocument();
  });

  it('HeroCTA adapts to the auth state', () => {
    auth.value = { user: null, isLoading: true };
    const { rerender } = render(<HeroCTA />);
    expect(screen.getByRole('link', { name: /Start Quiz Now/ })).toHaveAttribute('href', '/quizzes');
    auth.value = { user: { id: 'u' }, isLoading: false };
    rerender(<HeroCTA />);
    expect(screen.getByRole('link', { name: /Play Now/ })).toBeInTheDocument();
    auth.value = { user: null, isLoading: false };
    rerender(<HeroCTA />);
    expect(screen.getByRole('link', { name: /Play Free Now/ })).toHaveAttribute('href', '/register');
  });
});

describe('SectionNav', () => {
  const ids = ['top', 'stats', 'marquee', 'how', 'live', 'prizes', 'leaderboard', 'reviews', 'cta'];
  let scrollIntoView: ReturnType<typeof vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>>;
  let topOf: Record<string, number>;

  beforeEach(() => {
    frames();
    scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
    topOf = {};
    document.body.innerHTML = ids.map((id) => `<section id="${id}"></section>`).join('');
    for (const id of ids) {
      const el = document.getElementById(id)!;
      el.scrollIntoView = scrollIntoView;
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({ top: topOf[id] ?? 1000, bottom: (topOf[id] ?? 1000) + 500 }) as DOMRect);
    }
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
  });
  afterEach(() => { document.body.innerHTML = ''; });

  const link = (name: string) => screen.getByRole('link', { name });

  it('jumps to a section, re-aiming while lazy sections above it grow', () => {
    const { unmount } = render(<SectionNav />, { container: document.body.appendChild(document.createElement('div')) });
    fireEvent.click(link('Prizes'));
    expect(link('Prizes').querySelector('span')!.className).toContain('text-emerald-400');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth' });
    expect(window.history.pushState).toHaveBeenCalledWith(null, '', '#prizes');
    topOf.prizes = 1800; // content mounted above pushed the target down
    advance(20);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    advance(1000); // settles: 30 still frames
    const calls = scrollIntoView.mock.calls.length;
    advance(1000);
    expect(scrollIntoView).toHaveBeenCalledTimes(calls);
    unmount();
  });

  it('stops following when the user scrolls, starts over on a new click, and gives up after 5s', () => {
    const { unmount } = render(<SectionNav />, { container: document.body.appendChild(document.createElement('div')) });
    fireEvent.click(link('Reviews'));
    fireEvent.click(link('Leaderboard'));
    act(() => void window.dispatchEvent(new Event('wheel')));
    topOf.leaderboard = 50;
    advance(100);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    fireEvent.click(link('Get Started'));
    let y = 0;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => (y += 1) }); // never still
    advance(6000);
    const calls = scrollIntoView.mock.calls.length;
    advance(1000);
    expect(scrollIntoView).toHaveBeenCalledTimes(calls);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    fireEvent.click(link('Home'));
    unmount();
  });

  it('jumps without animation when the user prefers reduced motion', () => {
    media([REDUCED]);
    render(<SectionNav />, { container: document.body.appendChild(document.createElement('div')) });
    fireEvent.click(link('Prizes'));
    topOf.prizes = 1800;
    advance(20);
    expect(scrollIntoView.mock.calls).toEqual([[{ behavior: 'auto' }], [{ behavior: 'auto' }]]);
  });

  it('only highlights when the target section is missing', () => {
    document.getElementById('how')!.remove();
    render(<SectionNav />, { container: document.body.appendChild(document.createElement('div')) });
    fireEvent.click(link('How It Works'));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(link('How It Works').querySelector('span')!.className).toContain('text-emerald-400');
  });
});

describe('Stats', () => {
  it('counts up when visible and supports drag-scrolling on phones', () => {
    frames();
    const { container } = render(<Stats />);
    intersect();
    advance(2000);
    expect(screen.getByText('10,000')).toBeInTheDocument();
    // "from-rose-400 to-amber-400" starts at rose (it used to match "amber" first)
    expect([...container.querySelectorAll('#ring-grad-3 stop')].map((s) => s.getAttribute('stop-color'))).toEqual(['#fb7185', '#fbbf24']);
    const strip = container.querySelector('.snap-x') as HTMLElement;
    expect(strip).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('region', { name: 'Platform stats' })).toBe(strip);
    storeScrollLeft(strip);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    fireEvent.mouseDown(strip, { clientX: 100 });
    fireEvent.mouseMove(strip, { clientX: 50 });
    expect(strip.style.cursor).toBe('');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    fireEvent.mouseMove(strip, { clientX: 50 });
    fireEvent.mouseDown(strip, { clientX: 100 });
    expect(strip.style.cursor).toBe('grabbing');
    fireEvent.mouseMove(strip, { clientX: 60 });
    expect(strip.scrollLeft).toBe(80);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    fireEvent.mouseMove(strip, { clientX: 0 });
    fireEvent.mouseLeave(strip);
    expect(strip.style.cursor).toBe('');
  });
});

describe('CTA', () => {
  it('counts down to the next hour and links by auth state', () => {
    frames();
    vi.setSystemTime(new Date(2026, 9, 16, 10, 30, 0));
    const { rerender } = render(<CTA />);
    expect(screen.getByText('30m 00s')).toBeInTheDocument();
    advance(1000);
    expect(screen.getByText('29m 59s')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Register Now/ })).toHaveAttribute('href', '/register');
    auth.value = { user: { id: 'u' }, isLoading: false };
    rerender(<CTA />);
    expect(screen.getByRole('link', { name: /Play Now/ })).toHaveAttribute('href', '/quizzes');
    // Static copy while the real schedule loads
    expect(screen.getByText('Next tournament starts in')).toBeInTheDocument();
    expect(screen.getByText('2,184 players')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/live', { credentials: 'omit' });
  });

  it('keeps the static copy when the schedule cannot be loaded', async () => {
    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }));
    await loadLiveSnapshot();
    render(<CTA />);
    expect(screen.getByText('Next tournament starts in')).toBeInTheDocument();
    expect(screen.getByText('2,184 players')).toBeInTheDocument();
  });

  it('counts down to the next real quiz, with its start in Pakistan time, and shows real plays', async () => {
    frames();
    vi.setSystemTime(NOW);
    await primeLive([
      liveQuiz('open', { totalAttempts: 1200 }),
      liveQuiz('next', { status: 'upcoming', startsAt: new Date(NOW.getTime() + (2 * 3600 + 14 * 60 + 5) * 1000).toISOString(), totalAttempts: 84 }),
      liveQuiz('later', { status: 'upcoming', startsAt: minutesFromNow(24 * 60) }),
    ]);
    render(<CTA />);
    expect(screen.getByText('Next quiz starts in')).toBeInTheDocument();
    expect(screen.getByText('02h 14m 05s')).toBeInTheDocument();
    expect(screen.getByText('· Today, 7:14 PM PKT')).toBeInTheDocument();
    advance(1000);
    expect(screen.getByText('02h 14m 04s')).toBeInTheDocument();
    expect(screen.getByText('1,284 plays').parentElement).toHaveTextContent('1,284 plays so far on the current quizzes');
    expect(screen.queryByText('Next tournament starts in')).not.toBeInTheDocument();
    expect(screen.queryByText('2,184 players')).not.toBeInTheDocument();

    // Once it has started, the countdown moves on to the next one
    vi.setSystemTime(NOW.getTime() + (2 * 3600 + 14 * 60 + 6) * 1000);
    advance(1000);
    expect(screen.getByText('· Tomorrow, 5:00 PM PKT')).toBeInTheDocument();
  });

  it('says a quiz is open when nothing is scheduled but one can be played', async () => {
    frames();
    vi.setSystemTime(NOW);
    await primeLive([liveQuiz('live', { pushedAt: minutesFromNow(-1), totalAttempts: 1 })]);
    render(<CTA />);
    expect(screen.getByText(/A quiz is open right now/)).toBeInTheDocument();
    expect(screen.getByText('1 play').parentElement).toHaveTextContent('1 play so far on the current quiz');
  });

  it('says the next quiz starts soon when one is scheduled without a time still ahead', async () => {
    frames();
    vi.setSystemTime(NOW);
    await primeLive([liveQuiz('due', { status: 'upcoming', startsAt: minutesFromNow(-1) }), liveQuiz('untimed', { status: 'upcoming' })]);
    render(<CTA />);
    expect(screen.getByText('The next quiz starts soon')).toBeInTheDocument();
    expect(screen.getByText('2 quizzes').parentElement).toHaveTextContent('2 quizzes open or coming up — be the first to play');
  });

  it('has an honest empty state when nothing is scheduled', async () => {
    await primeLive([liveQuiz('soon', { status: 'upcoming' })]);
    const { unmount } = render(<CTA />);
    expect(screen.getByText('1 quiz').parentElement).toHaveTextContent('1 quiz open or coming up');
    unmount();

    resetLiveSnapshot();
    await primeLive([]);
    render(<CTA />);
    expect(screen.getByText(/No quiz is scheduled right now/)).toBeInTheDocument();
    expect(screen.getByText('Be first in line for the next quiz')).toBeInTheDocument();
    expect(screen.queryByText(/players/)).not.toBeInTheDocument();
  });
});

describe('Testimonials', () => {
  it('rotates the featured review and tilts cards under the pointer', () => {
    frames();
    render(<Testimonials />);
    const featured = () => screen.getByText('Featured review').parentElement!.textContent;
    expect(featured()).toContain('Hamza Siddiqui');
    advance(4000);
    expect(featured()).toContain('Areeba Khan');

    const card = screen.getAllByRole('article')[0];
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.mouseMove(card, { clientX: 100, clientY: 100 });
    expect(card.style.transform).toContain('rotateY(4deg)');
    fireEvent.mouseLeave(card);
    expect(card.style.transform).toContain('rotateY(0deg)');
    media([COARSE]);
    fireEvent.mouseMove(card, { clientX: 100, clientY: 100 });
    expect(card.style.transform).toContain('rotateY(0deg)');
  });
});

describe('Leaderboard', () => {
  it('reshuffles the demo board every 8 seconds and keeps ranks in order', () => {
    frames();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { container } = render(<Leaderboard />);
    advance(20);
    expect(screen.getByText('👑')).toBeInTheDocument();
    const names = () => [...container.querySelectorAll('li p.truncate')].map((p) => p.textContent!.split(' ')[0]);
    const before = names();
    advance(8000);
    expect(names()).not.toEqual(before);
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View full rankings/ })).toHaveAttribute('href', '/leaderboard');
  });
});

describe('LiveQuiz', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it('auto-advances only while visible', () => {
    frames();
    render(<LiveQuiz />);
    const active = () => screen.getAllByRole('button').findIndex((b) => b.className.includes('w-8'));
    advance(6000);
    expect(active()).toBe(0);
    intersect();
    advance(5000);
    expect(active()).toBe(1);
    advance(1000);
    expect(screen.getAllByText('892')[0]).toBeInTheDocument();
    intersect(false);
    advance(10000);
    expect(active()).toBe(1);
  });

  it('does not auto-advance when the user prefers reduced motion', () => {
    frames();
    media([REDUCED]);
    render(<LiveQuiz />);
    const active = () => screen.getAllByRole('button').findIndex((b) => b.className.includes('w-8'));
    advance(15000);
    expect(active()).toBe(0);
    expect(screen.getByRole('button', { name: 'Show quiz 1' })).toHaveAttribute('aria-current', 'true');
  });

  it('switches by dots, drag and swipe', () => {
    auth.value = { user: { id: 'u' }, isLoading: false };
    const { container } = render(<LiveQuiz />);
    const active = () => screen.getAllByRole('button').findIndex((b) => b.className.includes('w-8'));
    fireEvent.click(screen.getByRole('button', { name: 'Show quiz 3' }));
    expect(active()).toBe(2);
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled();
    expect(screen.getAllByRole('link', { name: /Join/ })[0]).toHaveAttribute('href', '/quizzes');

    const track = container.querySelector('.snap-x') as HTMLElement;
    storeScrollLeft(track);
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 100 });
    fireEvent.mouseMove(track, { clientX: 10 });
    fireEvent.mouseDown(track, { clientX: 100 });
    expect(track.style.cursor).toBe('grabbing');
    fireEvent.mouseMove(track, { clientX: 75 });
    expect(track.scrollLeft).toBe(50);
    fireEvent.mouseUp(track);
    expect(active()).toBe(1);

    fireEvent.touchStart(track, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(track, { changedTouches: [{ clientX: 100 }] });
    expect(active()).toBe(2);
    fireEvent.touchStart(track, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(track, { changedTouches: [{ clientX: 200 }] });
    expect(active()).toBe(1);
    fireEvent.touchStart(track, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(track, { changedTouches: [{ clientX: 120 }] });
    expect(active()).toBe(1);
  });

  const titles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

  it('shows the real quizzes: prize, entry, and countdowns with times in Pakistan time', async () => {
    frames();
    vi.setSystemTime(NOW);
    await primeLive([
      liveQuiz('up', { status: 'upcoming', title: 'PSL Final Predictor', startsAt: minutesFromNow(90), prizeName: 'Ronin Earbuds', accessPrice: 2 }),
      liveQuiz('live', { title: 'Hockey Night', pushedAt: minutesFromNow(-5), duration: 10, isBumperPrize: true, totalAttempts: 1284, questionCount: 1 }),
      liveQuiz('open', { title: 'Squash Basics', duration: 5 }),
      liveQuiz('closed', { title: 'Yesterday', pushedAt: minutesFromNow(-600) }),
    ], true);
    render(<LiveQuiz />);

    expect(titles()).toEqual(['Hockey Night', 'Squash Basics', 'PSL Final Predictor']);
    expect(screen.queryByText('Karachi Kings — PSL Ultimate Trivia')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Show quiz/ })).toHaveLength(3);

    // Live: closes in 5 minutes, bumper prize, real plays
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('05m 00s')).toBeInTheDocument();
    expect(screen.getByText('Closes · Today, 5:05 PM PKT')).toBeInTheDocument();
    expect(screen.getByText('🎁 Bumper prize')).toBeInTheDocument();
    expect(screen.getByText('Bumper prize')).toBeInTheDocument();
    expect(screen.getByText('1 question · 1,284 played')).toBeInTheDocument();
    // Always open
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open now')).toBeInTheDocument();
    expect(screen.getByText('Open any time')).toBeInTheDocument();
    expect(screen.getByText('⚡ Quiz')).toBeInTheDocument();
    expect(screen.getByText('5 min')).toBeInTheDocument();
    // Upcoming: the linked prize and the day-pass price
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText('01h 30m')).toBeInTheDocument();
    expect(screen.getByText('Starts · Today, 6:30 PM PKT')).toBeInTheDocument();
    expect(screen.getByText('🏆 Prize quiz')).toBeInTheDocument();
    expect(screen.getByText('Ronin Earbuds')).toBeInTheDocument();
    expect(screen.getByText('2 PKR')).toBeInTheDocument();
    expect(screen.getAllByText('Free')).toHaveLength(2);
    expect(screen.getAllByText('10 questions')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /Join/ })[0]).toHaveAttribute('href', '/register');

    advance(60_000);
    expect(screen.getByText('04m 00s')).toBeInTheDocument();
    expect(screen.getByText('01h 29m')).toBeInTheDocument();

    // The live quiz's window closes: its card goes
    advance(4 * 60_000);
    expect(titles()).toEqual(['Squash Basics', 'PSL Final Predictor']);

    // Past its start but not live yet (the server activates it on its next read)
    vi.setSystemTime(new Date(minutesFromNow(91)));
    advance(1000);
    expect(screen.getByText('Any moment')).toBeInTheDocument();
  });

  it('says "Soon" for a quiz scheduled without a time, and does not rotate a single card', async () => {
    frames();
    await primeLive([liveQuiz('untimed', { status: 'upcoming', title: 'Mystery Quiz' })]);
    render(<LiveQuiz />);
    intersect();
    advance(6000);
    expect(titles()).toEqual(['Mystery Quiz']);
    expect(screen.getByText('Soon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show quiz/ })).not.toBeInTheDocument();
  });

  it('rotates real cards while visible, and sends players to the quizzes page', async () => {
    frames();
    vi.setSystemTime(NOW);
    auth.value = { user: { id: 'u' }, isLoading: false };
    await primeLive([liveQuiz('a'), liveQuiz('b')]);
    render(<LiveQuiz />);
    expect(screen.getAllByRole('link', { name: /Join/ }).map((a) => a.getAttribute('href'))).toEqual(['/quizzes', '/quizzes']);
    const active = () => screen.getAllByRole('button', { name: /Show quiz/ }).findIndex((b) => b.className.includes('w-8'));
    intersect();
    advance(5000);
    expect(active()).toBe(1);
    advance(5000);
    expect(active()).toBe(0);
  });

  it('shows an empty state when nothing is live or scheduled', async () => {
    await primeLive([liveQuiz('paused', { status: 'paused', pushedAt: minutesFromNow(-1) })]);
    const { rerender } = render(<LiveQuiz />);
    expect(screen.getByText('No quiz is live right now')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show quiz/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign up free' })).toHaveAttribute('href', '/register');
    auth.value = { user: { id: 'u' }, isLoading: false };
    rerender(<LiveQuiz />);
    expect(screen.getByRole('link', { name: 'See quizzes' })).toHaveAttribute('href', '/quizzes');
  });

  it('keeps the demo cards when the quiz list cannot be loaded', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('offline'); });
    await loadLiveSnapshot();
    render(<LiveQuiz />);
    expect(screen.getByText('Karachi Kings — PSL Ultimate Trivia')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Show quiz/ })).toHaveLength(3);
  });

  it('keeps the selection inside the list when real quizzes replace the demo', async () => {
    let answer: (r: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve; }));
    render(<LiveQuiz />);
    fireEvent.click(screen.getByRole('button', { name: 'Show quiz 3' }));
    await act(async () => {
      answer(jsonResponse({ version: 'v1', walletEnabled: false, quizzes: [liveQuiz('a', { title: 'Only One' }), liveQuiz('b', { title: 'Second' })] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(titles()).toEqual(['Only One', 'Second']);
    expect(screen.getByRole('button', { name: 'Show quiz 2' })).toHaveAttribute('aria-current', 'true');

    const track = document.querySelector('.snap-x') as HTMLElement;
    fireEvent.touchStart(track, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(track, { changedTouches: [{ clientX: 100 }] });
    expect(screen.getByRole('button', { name: 'Show quiz 1' })).toHaveAttribute('aria-current', 'true');
  });
});
