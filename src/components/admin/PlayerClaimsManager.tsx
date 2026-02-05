'use client';

import { useState, useEffect, useCallback } from 'react';
import { Gift, Search, RefreshCw, Filter } from 'lucide-react';
import { toast } from 'sonner';

// Import extracted components
import {
  StatusStats,
  ClaimCard,
  ClaimDetailsModal,
  ClaimsSkeleton,
  getCSRFToken,
  type Claim,
  type ClaimStatus,
  type PaginationInfo,
} from '@/components/player-claims';

// ============================================
// Main Component (Refactored - ~250 lines from 702)
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
    } catch {
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

        toast.success(`Claim ${statusLabel.toLowerCase()}!`);
        await fetchClaims();
        setShowDetailsModal(false);
        setSelectedClaim(null);
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to update claim');
      }
    } catch {
      toast.error('An error occurred while updating the claim');
    } finally {
      setUpdating(null);
    }
  };

  // ============================================
  // Helpers
  // ============================================
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

  // Count claims by status
  const statusCounts: Record<ClaimStatus, number> = {
    pending: claims.filter(c => c.status === 'pending').length,
    approved: claims.filter(c => c.status === 'approved').length,
    fulfilled: claims.filter(c => c.status === 'fulfilled').length,
    rejected: claims.filter(c => c.status === 'rejected').length,
  };

  // ============================================
  // Render
  // ============================================
  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <StatusStats
        counts={statusCounts}
        selectedStatus={selectedStatus}
        onSelectStatus={(status) => {
          setSelectedStatus(status);
          setPagination(prev => ({ ...prev, page: 1 }));
        }}
      />

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
      {loading && <ClaimsSkeleton />}

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
          {filteredClaims.map((claim) => (
            <ClaimCard
              key={claim.id}
              claim={claim}
              updating={updating}
              onViewDetails={(c) => {
                setSelectedClaim(c);
                setShowDetailsModal(true);
              }}
              onUpdateStatus={updateClaimStatus}
            />
          ))}
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
        <ClaimDetailsModal
          claim={selectedClaim}
          updating={updating}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedClaim(null);
          }}
          onUpdateStatus={updateClaimStatus}
        />
      )}
    </div>
  );
}