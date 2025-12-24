'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
    getAllPrizesAdmin,
    createPrize,
    updatePrize,
    deletePrize,
    togglePrizeStatus,
    togglePrizeActive
} from '@/actions/prizes';
import PrizeTable from '@/components/admin/PrizeTable';
import PrizeForm from '@/components/admin/PrizeForm';
import type { Prize, PrizeFormData, PrizeCategory, PrizeStatus } from '@/types/prize';
import Link from 'next/link';

export default function AdminPrizesPage() {
    const [prizes, setPrizes] = useState<Prize[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingPrize, setEditingPrize] = useState<Prize | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<PrizeCategory | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<PrizeStatus | 'all'>('all');

    // Fetch prizes
    const fetchPrizes = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getAllPrizesAdmin({
                category: categoryFilter !== 'all' ? categoryFilter : undefined,
                status: statusFilter !== 'all' ? statusFilter : undefined,
                search: searchQuery || undefined,
            });

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
    }, [categoryFilter, statusFilter, searchQuery]);

    useEffect(() => {
        fetchPrizes();
    }, [fetchPrizes]);

    // Handle create/update
    const handleSubmit = async (formData: PrizeFormData) => {
        setIsSubmitting(true);

        try {
            if (editingPrize) {
                const result = await updatePrize(editingPrize.id, formData);
                if (result.success) {
                    toast.success('Prize updated successfully!');
                    setShowForm(false);
                    setEditingPrize(null);
                    fetchPrizes();
                } else {
                    toast.error(result.error || 'Failed to update prize');
                }
            } else {
                const result = await createPrize(formData);
                if (result.success) {
                    toast.success('Prize created successfully!');
                    setShowForm(false);
                    fetchPrizes();
                } else {
                    toast.error(result.error || 'Failed to create prize');
                }
            }
        } catch {
            toast.error('An error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle delete
    const handleDelete = async (prize: Prize) => {
        if (!confirm(`Are you sure you want to delete "${prize.name}"? This action cannot be undone.`)) {
            return;
        }

        const result = await deletePrize(prize.id);
        if (result.success) {
            toast.success('Prize deleted successfully!');
            fetchPrizes();
        } else {
            toast.error(result.error || 'Failed to delete prize');
        }
    };

    // Handle status toggle
    const handleToggleStatus = async (prize: Prize) => {
        const result = await togglePrizeStatus(prize.id);
        if (result.success) {
            toast.success(`Prize ${result.data?.status === 'published' ? 'published' : 'set to draft'}!`);
            fetchPrizes();
        } else {
            toast.error(result.error || 'Failed to update status');
        }
    };

    // Handle active toggle
    const handleToggleActive = async (prize: Prize) => {
        const result = await togglePrizeActive(prize.id);
        if (result.success) {
            toast.success(`Prize ${result.data?.isActive ? 'activated' : 'deactivated'}!`);
            fetchPrizes();
        } else {
            toast.error(result.error || 'Failed to update active state');
        }
    };

    // Handle edit
    const handleEdit = (prize: Prize) => {
        setEditingPrize(prize);
        setShowForm(true);
    };

    // Stats
    const stats = {
        total: prizes.length,
        published: prizes.filter(p => p.status === 'published').length,
        draft: prizes.filter(p => p.status === 'draft').length,
        outOfStock: prizes.filter(p => p.stock <= 0).length,
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900/30 to-slate-900">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <Link
                                href="/admin/dashboard"
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                ← Back to Dashboard
                            </Link>
                        </div>
                        <h1 className="text-2xl md:text-3xl font-bold text-white">Prize Management</h1>
                        <p className="text-gray-400 mt-1">Create, edit, and manage prizes for redemption</p>
                    </div>
                    <button
                        onClick={() => {
                            setEditingPrize(null);
                            setShowForm(true);
                        }}
                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-300 flex items-center gap-2"
                    >
                        <span>+</span>
                        Add New Prize
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                        { label: 'Total Prizes', value: stats.total, icon: '🎁', color: 'blue' },
                        { label: 'Published', value: stats.published, icon: '✅', color: 'green' },
                        { label: 'Drafts', value: stats.draft, icon: '📝', color: 'yellow' },
                        { label: 'Out of Stock', value: stats.outOfStock, icon: '⚠️', color: 'red' },
                    ].map((stat, index) => (
                        <div
                            key={index}
                            className="p-4 rounded-xl bg-slate-800/50 border border-white/10"
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-2xl">{stat.icon}</span>
                                <div>
                                    <p className="text-sm text-gray-400">{stat.label}</p>
                                    <p className="text-2xl font-bold text-white">{stat.value}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Filters */}
                <div className="flex flex-col md:flex-row gap-4 mb-6">
                    {/* Search */}
                    <div className="flex-1">
                        <input
                            type="text"
                            placeholder="Search prizes..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>

                    {/* Category Filter */}
                    <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value as PrizeCategory | 'all')}
                        className="px-4 py-3 bg-slate-800/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                    >
                        <option value="all">All Categories</option>
                        <option value="electronics">Electronics</option>
                        <option value="vehicles">Vehicles</option>
                        <option value="accessories">Accessories</option>
                        <option value="general">General</option>
                    </select>

                    {/* Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as PrizeStatus | 'all')}
                        className="px-4 py-3 bg-slate-800/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                    >
                        <option value="all">All Status</option>
                        <option value="published">Published</option>
                        <option value="draft">Draft</option>
                    </select>
                </div>

                {/* Table */}
                <PrizeTable
                    prizes={prizes}
                    loading={loading}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onToggleStatus={handleToggleStatus}
                    onToggleActive={handleToggleActive}
                />

                {/* Form Modal */}
                {showForm && (
                    <PrizeForm
                        prize={editingPrize}
                        onSubmit={handleSubmit}
                        onClose={() => {
                            setShowForm(false);
                            setEditingPrize(null);
                        }}
                        isSubmitting={isSubmitting}
                    />
                )}
            </div>
        </div>
    );
}
