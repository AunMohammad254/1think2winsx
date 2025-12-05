'use client';

import { useState, useEffect } from 'react';
import { useProfile } from '@/contexts/ProfileContext';
import Image from 'next/image';

interface Prize {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  modelUrl: string;
  type: string;
  pointsRequired: number;
}

interface RedemptionHistory {
  id: string;
  pointsUsed: number;
  status: string;
  requestedAt: string;
  processedAt?: string;
  notes?: string;
  prize: {
    name: string;
    description: string;
    imageUrl: string;
    type: string;
  };
}

interface RedemptionFormData {
  name: string;
  whatsappNumber: string;
  address: string;
}

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
  const [formData, setFormData] = useState<RedemptionFormData>({
    name: '',
    whatsappNumber: '',
    address: ''
  });
  const [formErrors, setFormErrors] = useState<Partial<RedemptionFormData>>({});

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
    } catch (error) {
      console.error('Error fetching prizes:', error);
    }
  };

  const fetchRedemptionHistory = async () => {
    try {
      const response = await fetch('/api/prize-redemption');
      if (response.ok) {
        const data = await response.json();
        setRedemptionHistory(data.redemptions || []);
      }
    } catch (error) {
      console.error('Error fetching redemption history:', error);
    } finally {
      setLoading(false);
    }
  };

  // Function to fetch CSRF token
  const getCSRFToken = async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/csrf-token');
      if (!response.ok) {
        throw new Error('Failed to fetch CSRF token');
      }
      const data = await response.json();
      return data.csrfToken;
    } catch (error) {
      console.error('Error fetching CSRF token:', error);
      return null;
    }
  };

  const handleRedeem = async (prizeId: string, prizeName: string, pointsRequired: number) => {
    if (!profile || profile.points < pointsRequired) {
      setError(`You need ${pointsRequired} points to redeem ${prizeName}. You currently have ${profile?.points || 0} points.`);
      return;
    }

    // Find the selected prize and show the form
    const prize = prizes.find(p => p.id === prizeId);
    if (prize) {
      setSelectedPrize(prize);
      setShowRedemptionForm(true);
      setError(null);
      setSuccess(null);
    }
  };

  const validateForm = (): boolean => {
    const errors: Partial<RedemptionFormData> = {};
    
    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }
    
    if (!formData.whatsappNumber.trim()) {
      errors.whatsappNumber = 'WhatsApp number is required';
    } else if (!/^\+?[\d\s-()]+$/.test(formData.whatsappNumber)) {
      errors.whatsappNumber = 'Please enter a valid WhatsApp number';
    }
    
    if (!formData.address.trim()) {
      errors.address = 'Address is required';
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFormSubmit = async () => {
    if (!selectedPrize || !validateForm()) {
      return;
    }

    setRedeeming(selectedPrize.id);
    setError(null);
    setSuccess(null);

    try {
      // Fetch CSRF token
      const csrfToken = await getCSRFToken();
      if (!csrfToken) {
        setError('Failed to get security token. Please try again.');
        return;
      }

      const response = await fetch('/api/prize-redemption', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ 
          prizeId: selectedPrize.id,
          fullName: formData.name,
          whatsappNumber: formData.whatsappNumber,
          address: formData.address
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(`Successfully redeemed ${selectedPrize.name}! Your redemption request is being processed.`);
        await refreshProfile(); // Refresh to update points
        await fetchRedemptionHistory(); // Refresh redemption history
        
        // Reset form and close popup
        setShowRedemptionForm(false);
        setSelectedPrize(null);
        setFormData({ name: '', whatsappNumber: '', address: '' });
        setFormErrors({});
      } else {
        setError(data.message || 'Failed to redeem prize');
      }
    } catch (error) {
      console.error('Error redeeming prize:', error);
      setError('An error occurred while redeeming the prize');
    } finally {
      setRedeeming(null);
    }
  };

  const handleCloseForm = () => {
    setShowRedemptionForm(false);
    setSelectedPrize(null);
    setFormData({ name: '', whatsappNumber: '', address: '' });
    setFormErrors({});
    setRedeeming(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
      case 'approved':
        return 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
      case 'fulfilled':
        return 'bg-green-500/20 text-green-300 border border-green-500/30';
      case 'rejected':
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
    }
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
            className={`py-4 px-1 border-b-2 font-medium text-sm glass-transition ${
              activeTab === 'prizes'
                ? 'border-blue-400 text-blue-300'
                : 'border-transparent text-gray-400 hover:text-white hover:border-blue-500/50'
            }`}
          >
            Available Prizes
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-4 px-1 border-b-2 font-medium text-sm glass-transition ${
              activeTab === 'history'
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
            <button
              onClick={() => setError(null)}
              className="float-right text-red-400 hover:text-red-200 glass-transition"
            >
              ×
            </button>
          </div>
        )}

        {success && (
          <div className="mb-4 bg-green-500/20 border border-green-500/30 text-green-300 px-4 py-3 rounded glass-card">
            {success}
            <button
              onClick={() => setSuccess(null)}
              className="float-right text-green-400 hover:text-green-200 glass-transition"
            >
              ×
            </button>
          </div>
        )}

        {/* Available Prizes Tab */}
        {activeTab === 'prizes' && (
          <div>
            {prizes.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {prizes.map((prize) => {
                  const canAfford = (profile?.points || 0) >= prize.pointsRequired;
                  const isRedeeming = redeeming === prize.id;

                  return (
                    <div key={prize.id} className="glass-card-blue glass-border glass-hover glass-transition overflow-hidden">
                      <div className="h-48 bg-gradient-glass-dark flex items-center justify-center">
                        <Image
                          src={prize.imageUrl || `/prizes/${prize.type}.svg`}
                          alt={prize.name}
                          width={128}
                          height={128}
                          className="h-32 w-32 object-contain"
                        />
                      </div>
                      <div className="p-4">
                        <h3 className="text-lg font-semibold text-white mb-2">{prize.name}</h3>
                        <p className="text-sm text-gray-300 mb-3">{prize.description}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-bold text-blue-400">
                            {prize.pointsRequired} points
                          </span>
                          <button
                            onClick={() => handleRedeem(prize.id, prize.name, prize.pointsRequired)}
                            disabled={!canAfford || isRedeeming}
                            className={`px-4 py-2 rounded-md text-sm font-medium glass-transition ${
                              canAfford && !isRedeeming
                                ? 'bg-blue-600 text-white hover:bg-blue-500 glass-hover-blue'
                                : 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            {isRedeeming ? 'Redeeming...' : canAfford ? 'Redeem' : 'Not enough points'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
                  <div key={redemption.id} className="glass-card glass-border p-4 glass-hover glass-transition">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="h-16 w-16 bg-gradient-glass-dark rounded-lg flex items-center justify-center glass-border">
                          <Image
                            src={redemption.prize.imageUrl || `/prizes/${redemption.prize.type}.svg`}
                            alt={redemption.prize.name}
                            width={48}
                            height={48}
                            className="h-12 w-12 object-contain"
                          />
                        </div>
                        <div>
                          <h3 className="font-semibold text-white">{redemption.prize.name}</h3>
                          <p className="text-sm text-gray-300">{redemption.prize.description}</p>
                          <p className="text-sm text-gray-400 mt-1">
                            Requested on {new Date(redemption.requestedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(redemption.status)}`}>
                          {redemption.status.charAt(0).toUpperCase() + redemption.status.slice(1)}
                        </span>
                        <p className="text-sm text-gray-300 mt-1">{redemption.pointsUsed} points</p>
                      </div>
                    </div>
                    {redemption.notes && (
                      <div className="mt-3 p-3 bg-gradient-glass-dark rounded-md glass-border">
                        <p className="text-sm text-gray-300">{redemption.notes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-400">You haven&apos;t redeemed any prizes yet.</p>
                <button
                  onClick={() => setActiveTab('prizes')}
                  className="mt-2 text-blue-400 hover:text-blue-300 font-medium glass-transition"
                >
                  Browse Available Prizes
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Redemption Form Popup */}
      {showRedemptionForm && selectedPrize && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-blue-dark glass-card glass-border max-w-md w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="bg-gradient-glass-blue px-6 py-4 glass-border-bottom">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Redeem Prize</h3>
                <button
                  onClick={handleCloseForm}
                  className="text-gray-400 hover:text-white glass-transition"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Prize Info */}
            <div className="p-6 glass-border-bottom">
              <div className="flex items-center space-x-4">
                <div className="h-16 w-16 bg-gradient-glass-dark rounded-lg flex items-center justify-center glass-border">
                  <Image
                    src={selectedPrize.imageUrl || `/prizes/${selectedPrize.type}.svg`}
                    alt={selectedPrize.name}
                    width={48}
                    height={48}
                    className="h-12 w-12 object-contain"
                  />
                </div>
                <div>
                  <h4 className="font-semibold text-white">{selectedPrize.name}</h4>
                  <p className="text-sm text-gray-300">{selectedPrize.description}</p>
                  <p className="text-sm text-blue-400 font-medium">{selectedPrize.pointsRequired} points</p>
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="p-6">
              <p className="text-sm text-gray-300 mb-4">
                Please provide your details for prize delivery:
              </p>

              <div className="space-y-4">
                {/* Name Field */}
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-white mb-2">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className={`w-full px-3 py-2 bg-gradient-glass-dark glass-border rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 glass-transition ${
                      formErrors.name ? 'border-red-500' : ''
                    }`}
                    placeholder="Enter your full name"
                  />
                  {formErrors.name && (
                    <p className="mt-1 text-sm text-red-400">{formErrors.name}</p>
                  )}
                </div>

                {/* WhatsApp Number Field */}
                <div>
                  <label htmlFor="whatsapp" className="block text-sm font-medium text-white mb-2">
                    WhatsApp Number *
                  </label>
                  <input
                    type="tel"
                    id="whatsapp"
                    value={formData.whatsappNumber}
                    onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                    className={`w-full px-3 py-2 bg-gradient-glass-dark glass-border rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 glass-transition ${
                      formErrors.whatsappNumber ? 'border-red-500' : ''
                    }`}
                    placeholder="Enter your WhatsApp number"
                  />
                  {formErrors.whatsappNumber && (
                    <p className="mt-1 text-sm text-red-400">{formErrors.whatsappNumber}</p>
                  )}
                </div>

                {/* Address Field */}
                <div>
                  <label htmlFor="address" className="block text-sm font-medium text-white mb-2">
                    Complete Address *
                  </label>
                  <textarea
                    id="address"
                    rows={3}
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className={`w-full px-3 py-2 bg-gradient-glass-dark glass-border rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 glass-transition resize-none ${
                      formErrors.address ? 'border-red-500' : ''
                    }`}
                    placeholder="Enter your complete delivery address"
                  />
                  {formErrors.address && (
                    <p className="mt-1 text-sm text-red-400">{formErrors.address}</p>
                  )}
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex space-x-3 mt-6">
                <button
                  onClick={handleCloseForm}
                  disabled={redeeming === selectedPrize.id}
                  className="flex-1 px-4 py-2 bg-gray-600/50 text-gray-300 rounded-md hover:bg-gray-600/70 glass-transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFormSubmit}
                  disabled={redeeming === selectedPrize.id}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 glass-hover-blue glass-transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {redeeming === selectedPrize.id ? 'Processing...' : 'Confirm Redemption'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}