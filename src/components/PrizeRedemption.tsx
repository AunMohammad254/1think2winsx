'use client';

import { useState, useEffect } from 'react';
import { useProfile } from '@/contexts/ProfileContext';
import Image from 'next/image';

// Import extracted components
import {
  PrizeCard,
  HistoryCard,
  RedemptionFormModal,
  getStatusColor,
  type Prize,
  type RedemptionHistory,
} from '@/components/prize-redemption';

// ============================================
// Main Component (Refactored - ~260 lines from 663)
// ============================================
export default function PrizeRedemption() {
  const { profile, refreshProfile } = useProfile();
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [redemptionHistory, setRedemptionHistory] = useState<RedemptionHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'prizes' | 'history'>('prizes');

  // Form popup state
  const [showRedemptionForm, setShowRedemptionForm] = useState(false);
  const [selectedPrize, setSelectedPrize] = useState<Prize | null>(null);

  // Preview modal state
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewPrize, setPreviewPrize] = useState<Prize | null>(null);
  const [previewRedemption, setPreviewRedemption] = useState<RedemptionHistory | null>(null);

  useEffect(() => {
    fetchPrizes();
    fetchRedemptionHistory();
  }, []);

  const fetchPrizes = async () => {
    try {
      const response = await fetch('/api/prizes');
      if (response.ok) {
        const data = await response.json();
        setPrizes(data.data || []);
      }
    } catch {
      // Error handled silently
    }
  };

  const fetchRedemptionHistory = async () => {
    try {
      const response = await fetch('/api/prize-redemption');
      if (response.ok) {
        const data = await response.json();
        setRedemptionHistory(data.redemptions || []);
      }
    } catch {
      // Error handled silently
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = (prizeId: string, prizeName: string, pointsRequired: number) => {
    if (!profile || profile.points < pointsRequired) {
      setError(`You need ${pointsRequired} points to redeem ${prizeName}. You currently have ${profile?.points || 0} points.`);
      return;
    }

    const prize = prizes.find(p => p.id === prizeId);
    if (prize) {
      setSelectedPrize(prize);
      setShowRedemptionForm(true);
      setError(null);
      setSuccess(null);
    }
  };

  const handleRedemptionSuccess = async () => {
    if (selectedPrize) {
      setSuccess(`Successfully redeemed ${selectedPrize.name}! Your redemption request is being processed.`);
    }
    await refreshProfile();
    await fetchRedemptionHistory();
    setShowRedemptionForm(false);
    setSelectedPrize(null);
    setRedeeming(null);
  };

  if (loading) {
    return (
      <div className="bg-gradient-blue-dark min-h-[200px] flex items-center justify-center glass-card">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto"></div>
          <p className="mt-4 text-white">Loading prizes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-blue-dark glass-card glass-border overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-glass-blue px-4 sm:px-6 py-4 text-white glass-border-bottom">
        <h2 className="text-lg sm:text-xl font-semibold">Prize Redemption</h2>
        <p className="text-sm text-blue-200 mt-1">
          You have <span className="font-bold text-yellow-300">{profile?.points || 0} points</span> available
        </p>
      </div>

      {/* Tabs */}
      <div className="glass-border-bottom">
        <nav className="flex space-x-8 px-4 sm:px-6">
          <button
            onClick={() => setActiveTab('prizes')}
            className={`py-4 px-1 border-b-2 font-medium text-sm glass-transition ${activeTab === 'prizes'
                ? 'border-blue-400 text-blue-300'
                : 'border-transparent text-gray-400 hover:text-white hover:border-blue-500/50'
              }`}
          >
            Available Prizes
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-4 px-1 border-b-2 font-medium text-sm glass-transition ${activeTab === 'history'
                ? 'border-blue-400 text-blue-300'
                : 'border-transparent text-gray-400 hover:text-white hover:border-blue-500/50'
              }`}
          >
            Redemption History
          </button>
        </nav>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6">
        {/* Error/Success Messages */}
        {error && (
          <div className="mb-4 bg-red-500/20 border border-red-500/30 text-red-300 px-4 py-3 rounded glass-card">
            {error}
            <button onClick={() => setError(null)} className="float-right text-red-400 hover:text-red-200">×</button>
          </div>
        )}

        {success && (
          <div className="mb-4 bg-green-500/20 border border-green-500/30 text-green-300 px-4 py-3 rounded glass-card">
            {success}
            <button onClick={() => setSuccess(null)} className="float-right text-green-400 hover:text-green-200">×</button>
          </div>
        )}

        {/* Available Prizes Tab */}
        {activeTab === 'prizes' && (
          <div>
            {prizes.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {prizes.map((prize) => (
                  <PrizeCard
                    key={prize.id}
                    prize={prize}
                    userPoints={profile?.points || 0}
                    isRedeeming={redeeming === prize.id}
                    onPreview={(p) => { setPreviewPrize(p); setShowPreviewModal(true); }}
                    onRedeem={handleRedeem}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-400">No prizes available at the moment.</p>
              </div>
            )}
          </div>
        )}

        {/* Redemption History Tab */}
        {activeTab === 'history' && (
          <div>
            {redemptionHistory.length > 0 ? (
              <div className="space-y-4">
                {redemptionHistory.map((redemption) => (
                  <HistoryCard
                    key={redemption.id}
                    redemption={redemption}
                    onPreview={(r) => { setPreviewRedemption(r); setShowPreviewModal(true); }}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-400">You haven&apos;t redeemed any prizes yet.</p>
                <button
                  onClick={() => setActiveTab('prizes')}
                  className="mt-2 text-blue-400 hover:text-blue-300 font-medium"
                >
                  Browse Available Prizes
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Redemption Form Modal */}
      {showRedemptionForm && selectedPrize && (
        <RedemptionFormModal
          prize={selectedPrize}
          isRedeeming={redeeming === selectedPrize.id}
          onClose={() => { setShowRedemptionForm(false); setSelectedPrize(null); }}
          onSuccess={handleRedemptionSuccess}
          onError={setError}
        />
      )}

      {/* Preview Modal */}
      {showPreviewModal && (previewPrize || previewRedemption) && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-blue-dark glass-card glass-border max-w-lg w-full max-h-[90vh] overflow-y-auto rounded-3xl">
            {/* Header */}
            <div className="bg-gradient-glass-blue px-6 py-4 glass-border-bottom flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                {previewPrize ? 'Prize Details' : 'Redemption Details'}
              </h3>
              <button
                onClick={() => { setShowPreviewModal(false); setPreviewPrize(null); setPreviewRedemption(null); }}
                className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <div className="flex justify-center mb-6">
                <div className="h-48 w-48 bg-gradient-glass-dark rounded-2xl overflow-hidden glass-border">
                  <Image
                    src={previewPrize?.imageUrl || previewRedemption?.prize.imageUrl || `/prizes/default.svg`}
                    alt={previewPrize?.name || previewRedemption?.prize.name || 'Prize'}
                    width={160}
                    height={160}
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>

              <div className="text-center mb-6">
                <h4 className="text-xl font-bold text-white mb-2">
                  {previewPrize?.name || previewRedemption?.prize.name}
                </h4>
                <p className="text-gray-300 text-sm leading-relaxed">
                  {previewPrize?.description || previewRedemption?.prize.description}
                </p>
              </div>

              {previewPrize && (
                <div className="bg-gradient-glass-dark rounded-xl p-4 glass-border">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Points Required</span>
                    <span className="text-lg font-bold text-blue-400">{previewPrize.pointsRequired} points</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-gray-400 text-sm">Your Points</span>
                    <span className={`text-lg font-bold ${(profile?.points || 0) >= previewPrize.pointsRequired ? 'text-green-400' : 'text-red-400'}`}>
                      {profile?.points || 0} points
                    </span>
                  </div>
                </div>
              )}

              {previewRedemption && (
                <div className="bg-gradient-glass-dark rounded-xl p-4 glass-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Status</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(previewRedemption.status)}`}>
                      {previewRedemption.status.charAt(0).toUpperCase() + previewRedemption.status.slice(1)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Points Used</span>
                    <span className="text-lg font-bold text-blue-400">{previewRedemption.pointsUsed} points</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Requested On</span>
                    <span className="text-white text-sm">{new Date(previewRedemption.requestedAt).toLocaleDateString()}</span>
                  </div>
                  {previewRedemption.notes && (
                    <div className="pt-3 border-t border-white/10">
                      <span className="text-gray-400 text-sm block mb-1">Admin Notes</span>
                      <p className="text-gray-300 text-sm">{previewRedemption.notes}</p>
                    </div>
                  )}
                </div>
              )}

              {previewPrize && (
                <button
                  onClick={() => {
                    setShowPreviewModal(false);
                    handleRedeem(previewPrize.id, previewPrize.name, previewPrize.pointsRequired);
                    setPreviewPrize(null);
                  }}
                  disabled={(profile?.points || 0) < previewPrize.pointsRequired}
                  className={`w-full mt-6 px-6 py-3 rounded-xl font-semibold ${(profile?.points || 0) >= previewPrize.pointsRequired
                      ? 'bg-blue-600 text-white hover:bg-blue-500'
                      : 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
                    }`}
                >
                  {(profile?.points || 0) >= previewPrize.pointsRequired
                    ? 'Redeem This Prize'
                    : `Need ${previewPrize.pointsRequired - (profile?.points || 0)} more points`}
                </button>
              )}

              {previewRedemption && (
                <button
                  onClick={() => { setShowPreviewModal(false); setPreviewRedemption(null); }}
                  className="w-full mt-6 px-6 py-3 rounded-xl font-semibold bg-gray-600/50 text-white hover:bg-gray-600/70"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}