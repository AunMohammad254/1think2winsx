'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import PrizeCard from '@/components/prizes/PrizeCard';
import PrizeFilters from '@/components/prizes/PrizeFilters';
import PrizeSkeleton from '@/components/prizes/PrizeSkeleton';
import { getPublicPrizes, redeemPrize } from '@/actions/prizes';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/contexts/ProfileContext';
import type { Prize, PrizeCategory, PrizeSortOption } from '@/types/prize';

// Redemption Modal Component
function RedemptionModal({
  prize,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  prize: Prize;
  onClose: () => void;
  onSubmit: (data: { fullName: string; whatsappNumber: string; address: string }) => void;
  isSubmitting: boolean;
}) {
  const [formData, setFormData] = useState({
    fullName: '',
    whatsappNumber: '',
    address: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative w-full max-w-md bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative p-6 border-b border-white/10 bg-gradient-to-r from-blue-600/20 to-purple-600/20">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-xl">🎁</span>
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Redeem Prize</h3>
              <p className="text-sm text-gray-400">{prize.name}</p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
            <input
              type="text"
              required
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="Enter your full name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">WhatsApp Number</label>
            <input
              type="tel"
              required
              value={formData.whatsappNumber}
              onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
              className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="03XX-XXXXXXX"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Delivery Address</label>
            <textarea
              required
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              rows={3}
              className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
              placeholder="Enter your complete address with city"
            />
          </div>

          {/* Points Info */}
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Points to be deducted:</span>
              <span className="text-lg font-bold text-yellow-400">
                {prize.pointsRequired.toLocaleString()} ⭐
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing...
              </>
            ) : (
              <>
                <span>🎉</span>
                Confirm Redemption
              </>
            )}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default function PrizesPage() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<PrizeCategory>('all');
  const [sortBy, setSortBy] = useState<PrizeSortOption>('points-asc');
  const [selectedPrize, setSelectedPrize] = useState<Prize | null>(null);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  const userPoints = profile?.points || 0;

  // Fetch prizes
  const fetchPrizes = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPublicPrizes(category, sortBy);
      if (result.success && result.data) {
        setPrizes(result.data);
      } else {
        toast.error(result.error || 'Failed to load prizes');
      }
    } catch {
      toast.error('Failed to load prizes');
    } finally {
      setLoading(false);
    }
  }, [category, sortBy]);

  useEffect(() => {
    fetchPrizes();
  }, [fetchPrizes]);

  // Handle redemption
  const handleRedeem = (prize: Prize) => {
    if (!user) {
      toast.error('Please log in to redeem prizes');
      return;
    }
    setSelectedPrize(prize);
  };

  const handleRedemptionSubmit = async (formData: { fullName: string; whatsappNumber: string; address: string }) => {
    if (!selectedPrize || !user) return;

    setRedeemingId(selectedPrize.id);

    // Optimistic update
    const previousPrizes = [...prizes];
    setPrizes(prizes.map(p =>
      p.id === selectedPrize.id
        ? { ...p, stock: Math.max(0, p.stock - 1) }
        : p
    ));

    try {
      const result = await redeemPrize(user.id, {
        prizeId: selectedPrize.id,
        ...formData,
      });

      if (result.success) {
        toast.success('🎉 Prize redeemed successfully! We will contact you soon.');
        setSelectedPrize(null);
        refreshProfile?.();
        fetchPrizes(); // Refresh to get latest stock
      } else {
        // Revert optimistic update
        setPrizes(previousPrizes);
        toast.error(result.error || 'Failed to redeem prize');
      }
    } catch {
      // Revert optimistic update
      setPrizes(previousPrizes);
      toast.error('Failed to redeem prize');
    } finally {
      setRedeemingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900/50 to-slate-900">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative">
        {/* Hero Section */}
        <section className="pt-12 pb-8 md:pt-20 md:pb-12">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-6"
            >
              <div className="inline-block px-6 py-3 rounded-full bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-white/10 text-base font-medium text-white">
                🏆 Redeem Your Points
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-white">
                Win <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Amazing</span> Prizes
              </h1>
              <p className="text-lg text-gray-300 max-w-2xl mx-auto">
                Use your hard-earned points to redeem incredible prizes. From electronics to vehicles,
                we have rewards for every champion!
              </p>

              {/* User Points Display */}
              {user && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-full"
                >
                  <span className="text-2xl">⭐</span>
                  <div className="text-left">
                    <p className="text-xs text-gray-400">Your Points</p>
                    <p className="text-xl font-bold text-yellow-400">{userPoints.toLocaleString()}</p>
                  </div>
                </motion.div>
              )}
            </motion.div>
          </div>
        </section>

        {/* Filters Section */}
        <section className="py-6">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <PrizeFilters
              selectedCategory={category}
              selectedSort={sortBy}
              onCategoryChange={setCategory}
              onSortChange={setSortBy}
              totalPrizes={prizes.length}
            />
          </div>
        </section>

        {/* Prizes Grid */}
        <section className="py-8 pb-20">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            {loading ? (
              <PrizeSkeleton count={6} />
            ) : prizes.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-20"
              >
                <div className="text-6xl mb-4">🎁</div>
                <h3 className="text-xl font-bold text-white mb-2">No prizes found</h3>
                <p className="text-gray-400">
                  {category !== 'all'
                    ? 'Try selecting a different category'
                    : 'Check back later for new prizes!'}
                </p>
              </motion.div>
            ) : (
              <motion.div
                layout
                className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6"
              >
                <AnimatePresence mode="popLayout">
                  {prizes.map((prize, index) => (
                    <PrizeCard
                      key={prize.id}
                      prize={prize}
                      userPoints={userPoints}
                      onRedeem={handleRedeem}
                      isRedeeming={redeemingId === prize.id}
                      variant={index === 0 ? 'featured' : 'default'}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        </section>

        {/* How to Earn More Points */}
        <section className="py-16 bg-gradient-to-b from-transparent to-slate-900/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto text-center">
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-8">
                Need More Points? 🚀
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { icon: '🎮', title: 'Play Quizzes', desc: 'Answer questions correctly to earn points' },
                  { icon: '🏆', title: 'Win Games', desc: 'Top scorers earn bonus points' },
                  { icon: '📅', title: 'Daily Rewards', desc: 'Play daily for streak bonuses' },
                ].map((item, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className="p-6 rounded-2xl bg-slate-800/50 border border-white/10 hover:border-white/20 transition-colors"
                  >
                    <div className="text-4xl mb-4">{item.icon}</div>
                    <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
                    <p className="text-sm text-gray-400">{item.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Redemption Modal */}
      <AnimatePresence>
        {selectedPrize && (
          <RedemptionModal
            prize={selectedPrize}
            onClose={() => setSelectedPrize(null)}
            onSubmit={handleRedemptionSubmit}
            isSubmitting={redeemingId === selectedPrize.id}
          />
        )}
      </AnimatePresence>
    </div>
  );
}