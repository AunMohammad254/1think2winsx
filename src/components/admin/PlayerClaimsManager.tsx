'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Gift, User, Phone, MapPin, Calendar, CheckCircle, XCircle, Clock, Eye, MessageSquare } from 'lucide-react';

interface User {
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
  user: User;
  prize: Prize;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function PlayerClaimsManager() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchClaims = useCallback(async () => {
    try {
      setLoading(true);
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
      } else {
        setError('Failed to fetch claims');
      }
    } catch (error) {
      console.error('Error fetching claims:', error);
      setError('An error occurred while fetching claims');
    } finally {
      setLoading(false);
    }
  }, [selectedStatus, pagination.page, pagination.limit]);

  useEffect(() => {
    fetchClaims();
  }, [selectedStatus, pagination.page, fetchClaims]);

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

  const updateClaimStatus = async (claimId: string, status: string, notes?: string) => {
    try {
      setUpdating(claimId);
      
      // Fetch CSRF token
      const csrfToken = await getCSRFToken();
      if (!csrfToken) {
        setError('Failed to get security token. Please try again.');
        return;
      }
      
      const response = await fetch('/api/admin/claims', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          claimId,
          status,
          notes,
        }),
      });

      if (response.ok) {
        await fetchClaims(); // Refresh the list
        setShowDetailsModal(false);
        setSelectedClaim(null);
      } else {
        const data = await response.json();
        setError(data.message || 'Failed to update claim status');
      }
    } catch (error) {
      console.error('Error updating claim:', error);
      setError('An error occurred while updating the claim');
    } finally {
      setUpdating(null);
    }
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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'approved':
        return <CheckCircle className="w-4 h-4" />;
      case 'fulfilled':
        return <CheckCircle className="w-4 h-4" />;
      case 'rejected':
        return <XCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="glass-card glass-border p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto"></div>
          <p className="mt-4 text-white">Loading claims...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-card glass-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Player Claims Management</h2>
            <p className="text-gray-300 mt-1">Review and approve reward claims from players</p>
          </div>
          <div className="flex items-center space-x-4">
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setPagination(prev => ({ ...prev, page: 1 }));
              }}
              className="bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="all">All Claims</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="glass-card glass-border p-4 bg-red-500/10 border-red-500/30">
          <p className="text-red-300">{error}</p>
        </div>
      )}

      {/* Claims List */}
      <div className="glass-card glass-border overflow-hidden">
        {claims.length === 0 ? (
          <div className="p-8 text-center">
            <Gift className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-300">No claims found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-glass-blue border-b border-white/10">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-medium text-white">Player</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-white">Prize</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-white">Points</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-white">Status</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-white">Requested</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-white">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {claims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-white/5 glass-transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
                          <User className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                          <p className="text-white font-medium">{claim.user.name}</p>
                          <p className="text-gray-400 text-sm">{claim.user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <Image
                          src={claim.prize.imageUrl}
                          alt={claim.prize.name}
                          width={40}
                          height={40}
                          className="rounded-lg object-cover"
                        />
                        <div>
                          <p className="text-white font-medium">{claim.prize.name}</p>
                          <p className="text-gray-400 text-sm">{claim.prize.type}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-yellow-300 font-medium">{claim.pointsUsed}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(claim.status)}`}>
                        {getStatusIcon(claim.status)}
                        <span className="capitalize">{claim.status}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-1 text-gray-300 text-sm">
                        <Calendar className="w-4 h-4" />
                        <span>{formatDate(claim.requestedAt)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => {
                            setSelectedClaim(claim);
                            setShowDetailsModal(true);
                          }}
                          className="p-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg glass-transition"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {claim.status === 'pending' && (
                          <>
                            <button
                              onClick={() => updateClaimStatus(claim.id, 'approved')}
                              disabled={updating === claim.id}
                              className="p-2 bg-green-500/20 hover:bg-green-500/30 text-green-300 rounded-lg glass-transition disabled:opacity-50"
                              title="Approve"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => updateClaimStatus(claim.id, 'rejected')}
                              disabled={updating === claim.id}
                              className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg glass-transition disabled:opacity-50"
                              title="Reject"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
            <div className="text-sm text-gray-300">
              Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} claims
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg glass-transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-white">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg glass-transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {showDetailsModal && selectedClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-gradient-blue-dark glass-card glass-border rounded-2xl overflow-hidden">
            <div className="bg-gradient-glass-blue px-6 py-4 glass-border-bottom">
              <h3 className="text-lg font-semibold text-white">Claim Details</h3>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Prize Info */}
              <div className="flex items-center space-x-4 p-4 bg-white/5 rounded-xl">
                <Image
                  src={selectedClaim.prize.imageUrl}
                  alt={selectedClaim.prize.name}
                  width={64}
                  height={64}
                  className="rounded-xl object-cover"
                />
                <div>
                  <h4 className="text-white font-medium">{selectedClaim.prize.name}</h4>
                  <p className="text-gray-300 text-sm">{selectedClaim.prize.description}</p>
                  <p className="text-yellow-300 text-sm mt-1">{selectedClaim.pointsUsed} points used</p>
                </div>
              </div>

              {/* Player Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <h5 className="text-white font-medium">Player Information</h5>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center space-x-2">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-300">Name:</span>
                      <span className="text-white">{selectedClaim.user.name}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-300">Email:</span>
                      <span className="text-white">{selectedClaim.user.email}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-300">Current Points:</span>
                      <span className="text-yellow-300">{selectedClaim.user.points}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h5 className="text-white font-medium">Claim Details</h5>
                  <div className="space-y-2 text-sm">
                    {selectedClaim.fullName && (
                      <div className="flex items-center space-x-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-300">Full Name:</span>
                        <span className="text-white">{selectedClaim.fullName}</span>
                      </div>
                    )}
                    {selectedClaim.whatsappNumber && (
                      <div className="flex items-center space-x-2">
                        <Phone className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-300">WhatsApp:</span>
                        <span className="text-white">{selectedClaim.whatsappNumber}</span>
                      </div>
                    )}
                    {selectedClaim.address && (
                      <div className="flex items-start space-x-2">
                        <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                        <div>
                          <span className="text-gray-300">Address:</span>
                          <p className="text-white mt-1">{selectedClaim.address}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Status and Notes */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className={`inline-flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-medium ${getStatusColor(selectedClaim.status)}`}>
                    {getStatusIcon(selectedClaim.status)}
                    <span className="capitalize">{selectedClaim.status}</span>
                  </span>
                  <div className="text-sm text-gray-300">
                    Requested: {formatDate(selectedClaim.requestedAt)}
                  </div>
                </div>

                {selectedClaim.notes && (
                  <div className="p-4 bg-white/5 rounded-xl">
                    <div className="flex items-center space-x-2 mb-2">
                      <MessageSquare className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-300 text-sm">Admin Notes:</span>
                    </div>
                    <p className="text-white text-sm">{selectedClaim.notes}</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              {selectedClaim.status === 'pending' && (
                <div className="flex space-x-3 pt-4 border-t border-white/10">
                  <button
                    onClick={() => updateClaimStatus(selectedClaim.id, 'approved')}
                    disabled={updating === selectedClaim.id}
                    className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl glass-transition disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>Approve Claim</span>
                  </button>
                  <button
                    onClick={() => updateClaimStatus(selectedClaim.id, 'rejected')}
                    disabled={updating === selectedClaim.id}
                    className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl glass-transition disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Reject Claim</span>
                  </button>
                </div>
              )}

              <div className="flex justify-end pt-4 border-t border-white/10">
                <button
                  onClick={() => {
                    setShowDetailsModal(false);
                    setSelectedClaim(null);
                  }}
                  className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl glass-transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}