import '@/tests/helpers/ui';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Trophy } from 'lucide-react';
import { existsSync } from 'node:fs';
import path from 'node:path';

const router = vi.hoisted(() => ({ prefetch: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

import { SportsBall, SPORTS_BALL_WIDTHS, sportsBallSrcSet } from '@/components/hero/SportsBall';
import StatsGrid from '@/components/profile/StatsGrid';
import BalanceCard from '@/components/profile/BalanceCard';
import ProfileHeader from '@/components/profile/ProfileHeader';
import ProfileAvatar from '@/components/profile/ProfileAvatar';
import QuickActions from '@/components/profile/QuickActions';
import PrizeSkeleton from '@/components/prizes/PrizeSkeleton';
import PrizeFilters from '@/components/prizes/PrizeFilters';
import PrizeCard from '@/components/prizes/PrizeCard';
import QuizCardSkeleton, { QuizCardSkeletonGrid } from '@/components/quiz/QuizCardSkeleton';
import QuizCard from '@/components/quiz/QuizCard';
import InsufficientBalanceModal from '@/components/quiz/InsufficientBalanceModal';
import ConfirmationModal from '@/components/quiz/ConfirmationModal';
import PaymentModal from '@/components/quiz/PaymentModal';
import WalletDisplay from '@/components/wallet/WalletDisplay';
import StepCard from '@/components/how-to-play/StepCard';
import HowToPlayPrizeCard from '@/components/how-to-play/PrizeCard';
import WinningTips from '@/components/how-to-play/WinningTips';
import FAQAccordion from '@/components/how-to-play/FAQAccordion';
import RulesTabs from '@/components/how-to-play/RulesTabs';
import KPICard, { KPICardSkeleton } from '@/components/admin/dashboard/KPICard';
import RecentActivityFeed, { RecentActivityFeedSkeleton } from '@/components/admin/dashboard/RecentActivityFeed';
import type { Prize } from '@/types/prize';

describe('hero decorations', () => {
  it.each(['cricket', 'basketball', 'tennis', 'football', 'hockey', 'squash', undefined] as const)('SportsBall draws a %s ball', (type) => {
    const { container } = render(<SportsBall type={type} className={type ? 'w-full' : ''} />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain(type ? 'w-full' : 'w-48');
    expect(container.querySelectorAll('div').length).toBeGreaterThan(3);
  });

  it('SportsBall draws a cricket ball for a sport it has no picture of', () => {
    render(<SportsBall type={'golf' as never} />);
    expect(screen.getByAltText('Cricket Ball')).toBeInTheDocument();
  });

  it("SportsBall loads static pre-sized files that Cloudflare caches, never Next's optimizer", () => {
    const { container } = render(<SportsBall type="hockey" />);
    const img = screen.getByAltText('Field Hockey Ball');
    expect(img).toHaveAttribute('src', '/images/sports/hockey.webp');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    const source = container.querySelector('picture > source');
    expect(source).toHaveAttribute('type', 'image/avif');
    expect(source).toHaveAttribute('srcset', sportsBallSrcSet('/images/sports/hockey.webp'));
    expect(container.innerHTML).not.toContain('/_next/image');
  });

  it('sportsBallSrcSet lists one AVIF copy per pre-sized width', () => {
    expect(sportsBallSrcSet('/images/sports/cricket.webp')).toBe(
      '/images/sports/cricket-128.avif 128w, /images/sports/cricket-256.avif 256w, ' +
        '/images/sports/cricket-384.avif 384w, /images/sports/cricket-512.avif 512w'
    );
  });

  it('every ball has a pre-sized AVIF copy on disk for each width', () => {
    for (const ball of ['cricket', 'basketball', 'tennis', 'football', 'hockey', 'squash']) {
      for (const width of SPORTS_BALL_WIDTHS) {
        expect(existsSync(path.join(process.cwd(), 'public', 'images', 'sports', `${ball}-${width}.avif`))).toBe(true);
      }
    }
  });
});

describe('profile pieces', () => {
  it('StatsGrid lists each stat with an accessible label', () => {
    render(<StatsGrid stats={[{ id: 'a', label: 'Quizzes', value: 3, icon: '📝' }, { id: 'b', label: 'Wins', value: '1', icon: '🏆', gradient: 'bg-gold' }]} />);
    expect(screen.getByRole('listitem', { name: 'Quizzes: 3' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Wins: 1' }).className).toContain('bg-gold');
  });

  it('BalanceCard shows the balance, or a loading placeholder', () => {
    const { rerender } = render(<BalanceCard balance={12.5} />);
    expect(screen.getByText('12.50')).toBeInTheDocument();
    expect(screen.getByText('Current wallet balance: 12.50 PKR.')).toBeInTheDocument();
    rerender(<BalanceCard balance={0} currency="USD" isLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('ProfileHeader links back and to the edit page', () => {
    const { rerender } = render(<ProfileHeader />);
    expect(screen.getByRole('link', { name: 'Go back to home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/profile/edit');
    rerender(<ProfileHeader title="Wallet" backHref="/profile" />);
    expect(screen.getByRole('link', { name: 'Go back to previous page' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('heading', { name: 'Wallet' })).toBeInTheDocument();
  });

  it('ProfileAvatar shows a photo or initials, and becomes a button with onClick', () => {
    const { rerender } = render(<ProfileAvatar name="ali raza khan" userId="u1" />);
    expect(screen.getByRole('img', { name: "ali raza khan's profile avatar" })).toHaveTextContent('AR');
    expect(screen.getByText('@u1')).toBeInTheDocument();
    const onClick = vi.fn();
    rerender(<ProfileAvatar name="Ali" imageSrc="https://img/a.png" size="sm" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update profile picture' }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'Ali' })).toBeInTheDocument();
    rerender(<ProfileAvatar name="Ali" size="md" onClick={onClick} actionLabel="Change photo" />);
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
  });

  it('QuickActions links the wallet and wires the change-password button', () => {
    const onChange = vi.fn();
    const { rerender } = render(<QuickActions onChangePasswordClick={onChange} />);
    expect(screen.getByRole('link', { name: 'Deposit' })).toHaveAttribute('href', '/profile/wallet');
    fireEvent.click(screen.getByRole('button', { name: 'Password' }));
    expect(onChange).toHaveBeenCalled();
    rerender(<QuickActions hideWalletActions />);
    expect(screen.queryByRole('link', { name: 'Deposit' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'History' })).toBeNull();
  });
});

const prize = (over: Partial<Prize> = {}): Prize => ({
  id: 'p1', name: 'Smart Watch', description: 'A watch', imageUrl: 'https://res.cloudinary.com/dszrz6s6u/image/upload/v1/prizes/watch.png', modelUrl: null, type: 'physical', pointsRequired: 1000,
  isActive: true, category: 'electronics', stock: 10, status: 'published', value: 15000, createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe('prizes', () => {
  it('PrizeSkeleton renders the requested number of cards', () => {
    const { container, rerender } = render(<PrizeSkeleton />);
    expect(container.firstElementChild!.children).toHaveLength(6);
    rerender(<PrizeSkeleton count={2} />);
    expect(container.firstElementChild!.children).toHaveLength(2);
  });

  it('PrizeFilters reports category and sort changes', () => {
    const onCategory = vi.fn();
    const onSort = vi.fn();
    render(<PrizeFilters selectedCategory="vehicles" selectedSort="newest" onCategoryChange={onCategory} onSortChange={onSort} totalPrizes={4} />);
    expect(screen.getByRole('button', { name: /Vehicles/ }).className).toContain('from-blue-600');
    fireEvent.click(screen.getByRole('button', { name: /Electronics/ }));
    expect(onCategory).toHaveBeenCalledWith('electronics');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'name-asc' } });
    expect(onSort).toHaveBeenCalledWith('name-asc');
    expect(screen.getByText('4')).toBeInTheDocument();
    render(<PrizeFilters selectedCategory="all" selectedSort="newest" onCategoryChange={onCategory} onSortChange={onSort} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('PrizeCard lets a player redeem when they have the points', () => {
    const onRedeem = vi.fn();
    render(<PrizeCard prize={prize()} userPoints={1500} onRedeem={onRedeem} variant="featured" />);
    expect(screen.getByText('Electronics')).toBeInTheDocument();
    expect(screen.queryByText(/PKR/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Redeem Now/ }));
    expect(onRedeem).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
  });

  it('PrizeCard explains why it cannot be redeemed', () => {
    const { rerender } = render(<PrizeCard prize={prize({ stock: 3, category: 'mystery' as Prize['category'], value: 0, description: null })} userPoints={400} />);
    expect(screen.getByText('Only 3 left!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Need 600 more points' })).toBeDisabled();
    expect(screen.getByText('Mystery')).toBeInTheDocument();
    rerender(<PrizeCard prize={prize({ stock: 0 })} userPoints={5000} />);
    expect(screen.getAllByText('Out of Stock')).toHaveLength(2);
    rerender(<PrizeCard prize={prize()} userPoints={0} isRedeeming />);
    expect(screen.getByRole('button', { name: /Processing/ })).toBeDisabled();
    rerender(<PrizeCard prize={prize()} onRedeem={undefined} userPoints={5000} />);
    fireEvent.click(screen.getByRole('button', { name: /Redeem Now/ }));
  });

  it('PrizeCard displays Claimed instead of Redeem and disables re-claiming while showing remaining stock', () => {
    const onRedeem = vi.fn();
    render(<PrizeCard prize={prize({ stock: 4 })} userPoints={5000} onRedeem={onRedeem} isClaimed />);
    expect(screen.getByText('Only 4 left!')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /claimed/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onRedeem).not.toHaveBeenCalled();
  });

  it('PrizeCard falls back to a gift icon when the image is missing or fails', () => {
    const { rerender } = render(<PrizeCard prize={prize({ imageUrl: null })} />);
    expect(screen.queryByRole('img')).toBeNull();
    rerender(<PrizeCard prize={prize()} />);
    // Cloudinary images are resized by Cloudinary's CDN through the shared loader
    expect(screen.getByRole('img', { name: 'Smart Watch' }).getAttribute('src')).toContain('/t_1Think2win/w_3840,c_limit,q_auto,f_auto/');
    fireEvent.error(screen.getByRole('img', { name: 'Smart Watch' }));
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('quiz cards and modals', () => {
  it('QuizCardSkeleton grids render the requested count', () => {
    const { container, rerender } = render(<QuizCardSkeletonGrid />);
    expect(container.firstElementChild!.children).toHaveLength(6);
    rerender(<QuizCardSkeletonGrid count={2} />);
    expect(container.firstElementChild!.children).toHaveLength(2);
    rerender(<QuizCardSkeleton />);
  });

  it('QuizCard labels the push status and opens the quiz without prefetching its page', () => {
    const base = { id: 'q1', title: 'Cricket', duration: 5, questionCount: 10 };
    const label = (props: Partial<Parameters<typeof QuizCard>[0]>) => {
      const { container, unmount } = render(<QuizCard {...base} status="paused" {...props} />);
      const text = container.querySelector('.qlabel')!.textContent;
      unmount();
      return text;
    };
    expect(label({ pushStatus: 'upcoming' })).toBe('Upcoming');
    expect(label({ pushStatus: 'time-up' })).toBe('Time-up');
    expect(label({ pushStatus: 'unanswered' })).toBe('Unanswered');
    expect(label({ status: 'active' })).toBe('Unanswered');
    expect(label({ pushStatus: 'answered' })).toBe('Answered');
    expect(label({ isCompleted: true })).toBe('Answered');
    expect(label({})).toBe('Missed');

    const onStart = vi.fn();
    render(<QuizCard {...base} status="new" pushStatus="upcoming" startsAt="2026-10-20T15:00:00Z" onStartClick={onStart} />);
    expect(screen.getByText(/Starts/)).toBeInTheDocument();
    // The card opens the live-quiz modal, never /quiz/<id>: a hover prefetch was a wasted origin request
    fireEvent.pointerEnter(screen.getByText('Cricket').parentElement!);
    expect(router.prefetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cricket'));
    expect(onStart).toHaveBeenCalledWith('q1');
  });

  it('QuizCard without a start handler lets the click through', () => {
    render(<QuizCard id="q2" title="Hockey" duration={5} questionCount={3} status="active" />);
    expect(() => fireEvent.click(screen.getByText('Hockey'))).not.toThrow();
  });

  it('payment modals show amounts and call back', () => {
    const fns = { onClose: vi.fn(), go: vi.fn(), pay: vi.fn(), confirm: vi.fn(), back: vi.fn() };
    const { rerender } = render(<InsufficientBalanceModal isOpen onClose={fns.onClose} walletBalance={0.5} accessPrice={2} handleGoToWallet={fns.go} />);
    expect(screen.getByText('1.50 PKR')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Manage Wallet/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fns.go).toHaveBeenCalled();
    rerender(<InsufficientBalanceModal isOpen={false} onClose={fns.onClose} walletBalance={0} accessPrice={2} handleGoToWallet={fns.go} />);
    expect(screen.queryByText('Insufficient Balance')).toBeNull();

    rerender(<ConfirmationModal isOpen onClose={fns.onClose} walletBalance={10} accessPrice={2} paymentLoading={false} handleConfirmedPayment={fns.confirm} onBack={fns.back} />);
    expect(screen.getByText('8.00 PKR')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Payment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(fns.confirm).toHaveBeenCalled();
    expect(fns.back).toHaveBeenCalled();
    rerender(<ConfirmationModal isOpen onClose={fns.onClose} walletBalance={10} accessPrice={2} paymentLoading handleConfirmedPayment={fns.confirm} onBack={fns.back} />);
    expect(screen.getByRole('button', { name: /Processing/ })).toBeDisabled();
    rerender(<ConfirmationModal isOpen={false} onClose={fns.onClose} walletBalance={10} accessPrice={2} paymentLoading={false} handleConfirmedPayment={fns.confirm} onBack={fns.back} />);
    expect(screen.queryByText('Confirm Payment')).toBeNull();

    rerender(<PaymentModal isOpen onClose={fns.onClose} accessPrice={2} paymentLoading={false} handlePayNowClick={fns.pay} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
    expect(fns.pay).toHaveBeenCalled();
    rerender(<PaymentModal isOpen onClose={fns.onClose} accessPrice={2} paymentLoading handlePayNowClick={fns.pay} />);
    expect(screen.getByRole('button', { name: /Checking/ })).toBeDisabled();
    rerender(<PaymentModal isOpen={false} onClose={fns.onClose} accessPrice={2} paymentLoading={false} handlePayNowClick={fns.pay} />);
    expect(screen.queryByText('Unlock Arena Access')).toBeNull();
  });

  it('WalletDisplay shows pending transactions', () => {
    const { rerender } = render(<WalletDisplay balance={5} pendingDeposits={1} pendingDeductions={2} />);
    expect(screen.getByLabelText('3 pending transactions')).toBeInTheDocument();
    expect(screen.getByText(/There are 3 pending transactions/)).toBeInTheDocument();
    rerender(<WalletDisplay balance={5} isLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/No pending transactions/)).toBeInTheDocument();
  });
});

describe('how-to-play sections', () => {
  it('StepCard and the prize cards render each tier', () => {
    render(<StepCard step={2} title="Pay" description="Pay 2 PKR" icon={Trophy} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    render(<HowToPlayPrizeCard name="Bike" description="CD 70" icon={Trophy} tier="grand" />);
    expect(screen.getByText('🏆 GRAND PRIZE')).toBeInTheDocument();
    render(<HowToPlayPrizeCard name="Phone" description="Android" icon={Trophy} tier="major" />);
    render(<HowToPlayPrizeCard name="Buds" description="Earbuds" icon={Trophy} tier="standard" delay={0.2} />);
    expect(screen.getAllByText('🏆 GRAND PRIZE')).toHaveLength(1);
    expect(screen.queryByText(/PKR 150,000/)).toBeNull();
  });

  it('WinningTips lists three tips', () => {
    render(<WinningTips />);
    expect(screen.getAllByRole('heading')).toHaveLength(3);
  });

  it('FAQAccordion opens one answer at a time', async () => {
    render(<FAQAccordion />);
    expect(screen.getByText(/each user is allowed only one attempt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /How are winners selected/ }));
    expect(await screen.findByText(/randomly selected from all participants/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /How are winners selected/ }));
    await vi.waitFor(() => expect(screen.queryByText(/randomly selected from all participants/)).toBeNull());
  });

  it('RulesTabs switches between rule sets', async () => {
    render(<RulesTabs />);
    expect(screen.getByText('10 Minutes Time Limit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Payment & Fees/ }));
    expect(await screen.findByText('Entry Fee: 2 PKR')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Points System/ }));
    expect(await screen.findByText('Performance Points')).toBeInTheDocument();
  });
});

describe('admin dashboard cards', () => {
  it('KPICard formats numbers and shows the trend direction', () => {
    const { rerender, container } = render(<KPICard title="Users" value={12345} icon="users" subtitle="all time" trend={{ value: 5, isPositive: true }} />);
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('5% from last week').parentElement!.className).toContain('text-green-400');
    rerender(<KPICard title="Revenue" value="PKR 10" icon="revenue" color="red" trend={{ value: 3, isPositive: false }} />);
    expect(screen.getByText('3% from last week').parentElement!.className).toContain('text-red-400');
    expect(container.innerHTML).toContain('rotate-180');
    rerender(<KPICardSkeleton />);
  });

  it('RecentActivityFeed shows attempts and sign-ups, or an empty state', () => {
    const now = new Date();
    const { rerender } = render(
      <RecentActivityFeed
        activities={[
          { id: '1', type: 'quiz_attempt', userId: 'u', userEmail: 'ali@x.com', userName: 'Ali', quizId: 'q', quizTitle: 'Cricket', score: 80, createdAt: now },
          { id: '2', type: 'quiz_attempt', userId: 'u', userEmail: 'sara@x.com', userName: null, quizId: 'q', quizTitle: 'Hockey', score: null, createdAt: now },
          { id: '3', type: 'user_signup', userId: 'u', userEmail: 'new@x.com', userName: null, quizId: null, quizTitle: null, score: null, createdAt: now },
        ]}
      />,
    );
    expect(screen.getByText('Score: 80%')).toBeInTheDocument();
    expect(screen.getByText('sara')).toBeInTheDocument();
    expect(within(screen.getByText('new').parentElement!).getByText('Joined the platform')).toBeInTheDocument();
    rerender(<RecentActivityFeed activities={[]} />);
    expect(screen.getByText('No recent activity')).toBeInTheDocument();
    rerender(<RecentActivityFeedSkeleton />);
  });

  it('RecentActivityFeed loads older activity only when asked, until there is no more', async () => {
    const at = new Date();
    const signup = (id: string) => ({ id, type: 'user_signup' as const, userId: id, userEmail: `${id}@x.com`, userName: null, quizId: null, quizTitle: null, score: null, createdAt: at });
    const loadMore = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ activities: [signup('older')], nextCursor: null });
    render(<RecentActivityFeed activities={[signup('newest')]} nextCursor="2026-10-21T10:00:00" loadMore={loadMore} />);
    expect(loadMore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load more activity");
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('older')).toBeInTheDocument();
    expect(screen.getByText('newest')).toBeInTheDocument();
    expect(loadMore).toHaveBeenNthCalledWith(2, { before: '2026-10-21T10:00:00' });
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
