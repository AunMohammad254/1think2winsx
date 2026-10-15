import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { findElement, resolveServerTree } from '@/tests/helpers/server-render';

const h = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('@/lib/admin-session', () => ({ requireAdminSession: async () => 'boss@x.com' }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) } }) }));
vi.mock('@/actions/analytics-actions', () => ({ getAnalyticsData: async () => h.data }));

import AdminAnalyticsPage from '@/app/admin/(protected)/analytics/page';

const days = (amounts: number[]) => amounts.map((amount, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, amount }));
const data = (over: Record<string, unknown> = {}) => ({
  revenue: days([0, 50, 120, 0, 80, 200, 60]),
  retention: { stickiness: 34, cohorts: [{ cohortName: 'Week 1', registered: 100, active: 80, rate: 80 }, { cohortName: 'Week 2', registered: 50, active: 25, rate: 50 }, { cohortName: 'Week 3', registered: 40, active: 4, rate: 10 }] },
  funnel: [{ stage: 'Started', count: 1000, percentage: 100 }, { stage: 'Completed', count: 640, percentage: 64 }, { stage: 'Won', count: 30, percentage: 3 }],
  prizes: {
    totalClaimedValue: 45000,
    stockByCategory: [{ category: 'electronics', stock: 7 }],
    redemptionsByStatus: [{ status: 'approved', count: 4 }, { status: 'pending', count: 2 }, { status: 'rejected', count: 1 }],
  },
  liveQuizEngagement: { totalLiveQuizzes: 12, totalLiveAttempts: 480, avgAttemptsPerLiveQuiz: 40 },
  scoreDistribution: [{ range: '0-20', count: 5 }, { range: '81-100', count: 20 }],
  notificationEfficacy: { ctr: 42, totalSent: 1000, totalRead: 420 },
  ...over,
});

const page = async () => render(await resolveServerTree(await AdminAnalyticsPage()));

beforeEach(() => { h.data = data(); });

describe('admin analytics page', () => {
  it('shows the headline numbers, charts and breakdowns', async () => {
    const { container } = await page();
    expect(screen.getByText('boss@x.com')).toBeInTheDocument();
    expect(screen.getByText('PKR 510')).toBeInTheDocument();
    expect(screen.getByText('34%')).toBeInTheDocument();
    expect(screen.getAllByText('64%').length).toBeGreaterThan(0);
    expect(screen.getByText('PKR 45,000')).toBeInTheDocument();
    expect(container.querySelectorAll('circle.fill-purple-500')).toHaveLength(5); // only days with revenue get a point
    expect(screen.getAllByText('PKR 200')).toHaveLength(2); // the peak's tooltip and the y-axis maximum
    expect(screen.getByText('10/07')).toBeInTheDocument(); // last date label
    for (const rate of ['80%', '50%', '10%']) expect(screen.getByText(rate)).toBeInTheDocument();
    expect(screen.getByText('7 items')).toBeInTheDocument();
    expect(screen.getByText('4 claims').className).toContain('text-green-400');
    expect(screen.getByText('2 claims').className).toContain('text-yellow-400');
    expect(screen.getByText('1 claims').className).toContain('text-red-400');
    expect(screen.getByText('480')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('copes with no data at all', async () => {
    h.data = data({
      revenue: [],
      funnel: [],
      prizes: { totalClaimedValue: 0, stockByCategory: [], redemptionsByStatus: [] },
      scoreDistribution: [{ range: '0-20', count: 0 }],
    });
    const { container } = await page();
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
    expect(screen.getByText('No prize stocks available.')).toBeInTheDocument();
    expect(screen.getByText('No prize redemptions requested yet.')).toBeInTheDocument();
    expect(container.querySelector('path[fill="url(#areaGrad)"]')).toBeNull();
  });

  it('KNOWN BUG: a single day of revenue draws the chart at NaN', async () => {
    // x = padding + (i * width) / (length - 1) divides by zero when there is one point.
    h.data = data({ revenue: days([75]) });
    const { container } = await page();
    expect(container.querySelector('circle.fill-purple-500')!.getAttribute('cx')).toBe('NaN');
  });

  it('shows a skeleton while the data loads', async () => {
    const boundary = findElement(await AdminAnalyticsPage(), Suspense)!;
    const { container } = render(<>{boundary.props.fallback as ReactNode}</>);
    expect(container.querySelectorAll('.bg-white\\/5').length).toBeGreaterThan(5);
  });
});
