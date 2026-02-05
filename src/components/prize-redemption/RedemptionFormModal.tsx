'use client';

import { useState } from 'react';
import Image from 'next/image';
import { getCSRFToken, type Prize, type RedemptionFormData } from './types';

interface RedemptionFormModalProps {
    prize: Prize;
    isRedeeming: boolean;
    onClose: () => void;
    onSuccess: () => void;
    onError: (message: string) => void;
}

/**
 * Form modal for collecting delivery details before redemption
 */
export function RedemptionFormModal({
    prize,
    isRedeeming,
    onClose,
    onSuccess,
    onError,
}: RedemptionFormModalProps) {
    const [formData, setFormData] = useState<RedemptionFormData>({
        name: '',
        whatsappNumber: '',
        address: '',
    });
    const [formErrors, setFormErrors] = useState<Partial<RedemptionFormData>>({});
    const [submitting, setSubmitting] = useState(false);

    const validateForm = (): boolean => {
        const errors: Partial<RedemptionFormData> = {};

        if (!formData.name.trim()) {
            errors.name = 'Name is required';
        }

        if (!formData.whatsappNumber.trim()) {
            errors.whatsappNumber = 'WhatsApp number is required';
        } else if (!/^\+?[\d\s\-()]+$/.test(formData.whatsappNumber)) {
            errors.whatsappNumber = 'Please enter a valid WhatsApp number';
        }

        if (!formData.address.trim()) {
            errors.address = 'Address is required';
        }

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async () => {
        if (!validateForm()) return;

        setSubmitting(true);

        try {
            const csrfToken = await getCSRFToken();
            if (!csrfToken) {
                onError('Failed to get security token. Please try again.');
                return;
            }

            const response = await fetch('/api/prize-redemption', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                body: JSON.stringify({
                    prizeId: prize.id,
                    fullName: formData.name,
                    whatsappNumber: formData.whatsappNumber,
                    address: formData.address,
                }),
            });

            const data = await response.json();

            if (response.ok) {
                onSuccess();
                onClose();
            } else {
                onError(data.message || 'Failed to redeem prize');
            }
        } catch {
            onError('An error occurred while redeeming the prize');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-blue-dark glass-card glass-border max-w-md w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="bg-gradient-glass-blue px-6 py-4 glass-border-bottom">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-white">Redeem Prize</h3>
                        <button
                            onClick={onClose}
                            disabled={submitting || isRedeeming}
                            className="text-gray-400 hover:text-white glass-transition disabled:opacity-50"
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
                                src={prize.imageUrl || `/prizes/${prize.type}.svg`}
                                alt={prize.name}
                                width={48}
                                height={48}
                                className="h-12 w-12 object-contain"
                            />
                        </div>
                        <div>
                            <h4 className="font-semibold text-white">{prize.name}</h4>
                            <p className="text-sm text-gray-300">{prize.description}</p>
                            <p className="text-sm text-blue-400 font-medium">{prize.pointsRequired} points</p>
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
                                className={`w-full px-3 py-2 bg-gradient-glass-dark glass-border rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 glass-transition ${formErrors.name ? 'border-red-500' : ''
                                    }`}
                                placeholder="Enter your full name"
                            />
                            {formErrors.name && <p className="mt-1 text-sm text-red-400">{formErrors.name}</p>}
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
                                className={`w-full px-3 py-2 bg-gradient-glass-dark glass-border rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 glass-transition ${formErrors.whatsappNumber ? 'border-red-500' : ''
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
                                className={`w-full px-3 py-2 bg-gradient-glass-dark glass-border rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 glass-transition resize-none ${formErrors.address ? 'border-red-500' : ''
                                    }`}
                                placeholder="Enter your complete delivery address"
                            />
                            {formErrors.address && <p className="mt-1 text-sm text-red-400">{formErrors.address}</p>}
                        </div>
                    </div>

                    {/* Form Actions */}
                    <div className="flex space-x-3 mt-6">
                        <button
                            onClick={onClose}
                            disabled={submitting || isRedeeming}
                            className="flex-1 px-4 py-2 bg-gray-600/50 text-gray-300 rounded-md hover:bg-gray-600/70 glass-transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || isRedeeming}
                            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 glass-hover-blue glass-transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submitting || isRedeeming ? 'Processing...' : 'Confirm Redemption'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
