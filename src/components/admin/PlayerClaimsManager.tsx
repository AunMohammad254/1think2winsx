'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  Gift,
  User,
  Phone,
  MapPin,
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  MessageSquare,
  Search,
  RefreshCw,
  Filter,
  Loader2,
  Package,
  AlertCircle,
  X
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================
// Types
// ============================================
interface UserData {
  id: string;
  name: string;
  email: string;
  phone: string;
  points: number;
}

interface Prize {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  type: string;
  pointsRequired: number;
}

interface Claim {
  id: string;
  pointsUsed: number;
  status: 'pending' | 'approved' | 'rejected' | 'fulfilled';
  fullName: string | null;
  whatsappNumber: string | null;
  address: string | null;
  requestedAt: string;
  processedAt: string | null;
  notes: string | null;
  user: UserData;
  prize: Prize;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ============================================
// Status Configuration
// ============================================
const statusConfig = {
  pending: {
    label: 'Pending Review',
    bgClass: 'bg-amber-500/20',
    textClass: 'text-amber-300',
    borderClass: 'border-amber-500/30',
    icon: Clock,
  },
  approved: {
    label: 'Approved',
    bgClass: 'bg-blue-500/20',
    textClass: 'text-blue-300',
    borderClass: 'border-blue-500/30',
    icon: CheckCircle,
  },
  fulfilled: {
    label: 'Fulfilled',
    bgClass: 'bg-emerald-500/20',
    textClass: 'text-emerald-300',
    borderClass: 'border-emerald-500/30',
    icon: Package,
  },
  rejected: {
    label: 'Rejected',
    bgClass: 'bg-red-500/20',
    textClass: 'text-red-300',
    borderClass: 'border-red-500/30',
    icon: XCircle,
  },
} as const;

// ============================================
// Main Component
// ============================================
export default function PlayerClaimsManager() {
  // State
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [actionNotes, setActionNotes] = useState('');

  // ============================================
  // Data Fetching
  // ============================================
  const fetchClaims = useCallback(async (showRefreshState = false) => {
    try {
      if (showRefreshState) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });

      if (selectedStatus !== 'all') {
        params.append('status', selectedStatus);
      }

      const response = await fetch(`/api/admin/claims?${params}`);

      if (response.ok) {
        const data = await response.json();
        setClaims(data.claims || []);
        setPagination(data.pagination);

        if (showRefreshState) {
          toast.success('Claims refreshed');
        }
      } else if (response.status === 401) {
        toast.error('Session expired. Redirecting to login...');
        window.location.href = '/admin/login';
      } else {
        throw new Error('Failed to fetch claims');
      }
    } catch (error) {
      console.error('Error fetching claims:', error);
      toast.error('Failed to load claims');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedStatus, pagination.page, pagination.limit]);

  useEffect(() => {
    fetchClaims();
  }, [selectedStatus, pagination.page, fetchClaims]);

  // ============================================
  // CSRF Token
  // ============================================
  const getCSRFToken = async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/csrf-token');
      if (!response.ok) throw new Error('Failed to fetch CSRF token');
      const data = await response.json();
      return data.csrfToken;
    } catch (error) {
      console.error('Error fetching CSRF token:', error);
      return null;
    }
  };

  // ============================================
  // Actions
  // ============================================
  const updateClaimStatus = async (claimId: string, status: string, notes?: string) => {
    try {
      setUpdating(claimId);

      const csrfToken = await getCSRFToken();
      if (!csrfToken) {
        toast.error('Security token expired. Please refresh the page.');
        return;
      }

      const response = await fetch('/api/admin/claims', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ claimId, status, notes }),
      });

      if (response.ok) {
        const statusLabel = status === 'approved' ? 'Approved' :
          status === 'rejected' ? 'Rejected' :
            status === 'fulfilled' ? 'Fulfilled' : status;

        toast.success(`Claim ${statusLabel.toLowerCase()}!`, {
          icon: status === 'approved' ? <CheckCircle className="w-5 h-5 text-blue-400" /> :
            status === 'rejected' ? <XCircle className="w-5 h-5 text-red-400" /> :
              <Package className="w-5 h-5 text-emerald-400" />,
        });

        await fetchClaims();
        setShowDetailsModal(false);
        setSelectedClaim(null);
        setActionNotes('');
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to update claim');
      }
    } catch (error) {
      console.error('Error updating claim:', error);
      toast.error('An error occurred while updating the claim');
    } finally {
      setUpdating(null);
    }
  };

  // ============================================
  // Helpers
  // ============================================
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Filter claims by search
  const filteredClaims = claims.filter(claim => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      claim.user.name?.toLowerCase().includes(query) ||
      claim.user.email?.toLowerCase().includes(query) ||
      claim.prize.name?.toLowerCase().includes(query) ||
      claim.fullName?.toLowerCase().includes(query)
    );
  });

  const pendingCount = claims.filter(c => c.status === 'pending').length;

  // ============================================
  // Render
  // ============================================
  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {(['pending', 'approved', 'fulfilled', 'rejected'] as const).map((status) => {
          const config = statusConfig[status];
          const count = claims.filter(c => c.status === status).length;
          const Icon = config.icon;

          return (
            <button
              key={status}
              onClick={() => {
                setSelectedStatus(status);
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              className={`p-4 rounded-xl border transition-all duration-200 text-left ${selectedStatus === status
                ? `${config.bgClass} ${config.borderClass} ring-1 ring-white/10`
                : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${config.bgClass}`}>
                  <Icon className={`w-5 h-5 ${config.textClass}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{count}</p>
                  <p className="text-sm text-gray-400">{config.label}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by player name, email, or prize..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-400 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/25"
          />
        </div>

        {/* Filter & Refresh */}
        <div className="flex gap-2">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              className="appearance-none pl-9 pr-8 py-3 rounded-xl bg-gray-800 border border-white/10 text-white focus:outline-none focus:border-amber-500/50 cursor-pointer"
              style={{ colorScheme: 'dark' }}
            >
              <option value="pending" className="bg-gray-800 text-white">Pending</option>
              <option value="approved" className="bg-gray-800 text-white">Approved</option>
              <option value="fulfilled" className="bg-gray-800 text-white">Fulfilled</option>
              <option value="rejected" className="bg-gray-800 text-white">Rejected</option>
              <option value="all" className="bg-gray-800 text-white">All Claims</option>
            </select>
          </div>
          <button
            onClick={() => fetchClaims(true)}
            disabled={isRefreshing}
            className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-6 rounded-xl border border-white/10 bg-white/5 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 bg-white/10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/10 rounded w-1/3" />
                  <div className="h-3 bg-white/10 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredClaims.length === 0 && (
        <div className="text-center py-16 rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/30">
          <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-full flex items-center justify-center">
            <Gift className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">No Claims Found</h3>
          <p className="text-gray-400 max-w-md mx-auto">
            {searchQuery
              ? `No claims match "${searchQuery}".`
              : selectedStatus === 'all'
                ? 'No prize claims have been submitted yet.'
                : `No ${selectedStatus} claims found.`}
          </p>
        </div>
      )}

      {/* Claims List */}
      {!loading && filteredClaims.length > 0 && (
        <div className="space-y-4">
          {filteredClaims.map((claim) => {
            const config = statusConfig[claim.status];
            const StatusIcon = config.icon;

            return (
              <div
                key={claim.id}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/60 to-gray-800/40 p-6 transition-all duration-300 hover:border-white/20"
              >
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                  {/* Player & Prize */}
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <Image
                        src={claim.prize.imageUrl}
                        alt={claim.prize.name}
                        width={64}
                        height={64}
                        className="rounded-xl object-cover shadow-lg"
                      />
                      <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg">
                        {claim.user.name?.charAt(0) || '?'}
                      </div>
                    </div>
                    <div>
                      <p className="text-white font-semibold text-lg">{claim.prize.name}</p>
                      <p className="text-gray-400 text-sm">{claim.user.name} • {claim.user.email}</p>
                      <p className="text-amber-300 text-sm font-medium">{claim.pointsUsed} points</p>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="flex flex-wrap gap-4 items-center">
                    <div>
                      <p className="text-gray-500 text-xs uppercase">Requested</p>
                      <p className="text-white text-sm">{formatDate(claim.requestedAt)}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${config.bgClass} ${config.textClass}`}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      {config.label}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => {
                        setSelectedClaim(claim);
                        setShowDetailsModal(true);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2"
                    >
                      <Eye className="w-4 h-4" />
                      Details
                    </button>
                    {claim.status === 'pending' && (
                      <>
                        <button
                          onClick={() => updateClaimStatus(claim.id, 'approved')}
                          disabled={updating === claim.id}
                          className="px-4 py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                          {updating === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                          Approve
                        </button>
                        <button
                          onClick={() => updateClaimStatus(claim.id, 'rejected')}
                          disabled={updating === claim.id}
                          className="px-4 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                          <XCircle className="w-4 h-4" />
                          Reject
                        </button>
                      </>
                    )}
                    {claim.status === 'approved' && (
                      <button
                        onClick={() => updateClaimStatus(claim.id, 'fulfilled')}
                        disabled={updating === claim.id}
                        className="px-4 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-all disabled:opacity-50 flex items-center gap-2"
                      >
                        {updating === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                        Mark Fulfilled
                      </button>
                    )}
                  </div>
                </div>

                {/* Notes */}
                {claim.notes && (
                  <div className="mt-4 p-3 bg-white/5 rounded-xl flex gap-2">
                    <MessageSquare className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                    <p className="text-gray-300 text-sm">{claim.notes}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 bg-white/5">
          <p className="text-sm text-gray-400">
            Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
              disabled={pagination.page === 1}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
              disabled={pagination.page === pagination.totalPages}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {showDetailsModal && selectedClaim && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => {
            setShowDetailsModal(false);
            setSelectedClaim(null);
            setActionNotes('');
          }}
        >
          <div
            className="w-full max-w-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-white/10 rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Claim Details</h3>
              <button
                onClick={() => {
                  setShowDetailsModal(false);
                  setSelectedClaim(null);
                }}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Prize Info */}
              <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl">
                <Image
                  src={selectedClaim.prize.imageUrl}
                  alt={selectedClaim.prize.name}
                  width={80}
                  height={80}
                  className="rounded-xl object-cover"
                />
                <div>
                  <h4 className="text-white font-semibold text-lg">{selectedClaim.prize.name}</h4>
                  <p className="text-gray-400 text-sm">{selectedClaim.prize.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="px-2 py-1 rounded-md bg-amber-500/20 text-amber-300 text-xs font-medium">
                      {selectedClaim.pointsUsed} points
                    </span>
                    <span className="px-2 py-1 rounded-md bg-purple-500/20 text-purple-300 text-xs font-medium">
                      {selectedClaim.prize.type}
                    </span>
                  </div>
                </div>
              </div>

              {/* Player & Claim Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h5 className="text-white font-medium flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-400" />
                    Player Information
                  </h5>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 w-24">Account:</span>
                      <span className="text-white">{selectedClaim.user.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 w-24">Email:</span>
                      <span className="text-white">{selectedClaim.user.email}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 w-24">Points:</span>
                      <span className="text-amber-300 font-medium">{selectedClaim.user.points}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h5 className="text-white font-medium flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    Delivery Details
                  </h5>
                  <div className="space-y-3 text-sm">
                    {selectedClaim.fullName && (
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400 w-24">Full Name:</span>
                        <span className="text-white">{selectedClaim.fullName}</span>
                      </div>
                    )}
                    {selectedClaim.whatsappNumber && (
                      <div className="flex items-center gap-3">
                        <Phone className="w-4 h-4 text-gray-400" />
                        <span className="text-white">{selectedClaim.whatsappNumber}</span>
                      </div>
                    )}
                    {selectedClaim.address && (
                      <div className="flex items-start gap-3">
                        <MapPin className="w-4 h-4 text-gray-400 mt-1" />
                        <span className="text-white">{selectedClaim.address}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Status & Timeline */}
              <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                <div className="flex items-center gap-3">
                  {(() => {
                    const config = statusConfig[selectedClaim.status];
                    const Icon = config.icon;
                    return (
                      <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${config.bgClass} ${config.textClass}`}>
                        <Icon className="w-4 h-4" />
                        {config.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="text-right text-sm">
                  <div className="flex items-center gap-2 text-gray-400">
                    <Calendar className="w-4 h-4" />
                    <span>Requested: {formatDate(selectedClaim.requestedAt)}</span>
                  </div>
                  {selectedClaim.processedAt && (
                    <p className="text-gray-500 mt-1">
                      Processed: {formatDate(selectedClaim.processedAt)}
                    </p>
                  )}
                </div>
              </div>

              {/* Existing Notes */}
              {selectedClaim.notes && (
                <div className="p-4 bg-white/5 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-300 text-sm font-medium">Admin Notes</span>
                  </div>
                  <p className="text-white text-sm">{selectedClaim.notes}</p>
                </div>
              )}

              {/* Actions for Pending */}
              {selectedClaim.status === 'pending' && (
                <div className="space-y-4 pt-4 border-t border-white/10">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">Add notes (optional)</label>
                    <textarea
                      value={actionNotes}
                      onChange={(e) => setActionNotes(e.target.value)}
                      placeholder="Add any notes about this claim..."
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 resize-none"
                      rows={2}
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => updateClaimStatus(selectedClaim.id, 'approved', actionNotes)}
                      disabled={updating === selectedClaim.id}
                      className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
                    >
                      {updating === selectedClaim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      Approve Claim
                    </button>
                    <button
                      onClick={() => updateClaimStatus(selectedClaim.id, 'rejected', actionNotes)}
                      disabled={updating === selectedClaim.id}
                      className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject Claim
                    </button>
                  </div>
                </div>
              )}

              {/* Action for Approved */}
              {selectedClaim.status === 'approved' && (
                <div className="pt-4 border-t border-white/10">
                  <button
                    onClick={() => updateClaimStatus(selectedClaim.id, 'fulfilled')}
                    disabled={updating === selectedClaim.id}
                    className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
                  >
                    {updating === selectedClaim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                    Mark as Fulfilled / Delivered
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}