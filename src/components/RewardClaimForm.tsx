'use client';

import { useState } from 'react';
import Image from 'next/image';
import { X, User, Phone, MapPin, Gift } from 'lucide-react';

interface Prize {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  type: string;
  pointsRequired: number;
}

interface RewardClaimFormProps {
  isOpen: boolean;
  onClose: () => void;
  prize: Prize | null;
  onSubmit: (claimData: {
    fullName: string;
    whatsappNumber: string;
    address: string;
  }) => Promise<void>;
  isSubmitting: boolean;
}

export default function RewardClaimForm({
  isOpen,
  onClose,
  prize,
  onSubmit,
  isSubmitting
}: RewardClaimFormProps) {
  const [formData, setFormData] = useState({
    fullName: '',
    whatsappNumber: '',
    address: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.fullName.trim()) {
      newErrors.fullName = 'Full name is required';
    } else if (formData.fullName.trim().length < 2) {
      newErrors.fullName = 'Full name must be at least 2 characters';
    }

    if (!formData.whatsappNumber.trim()) {
      newErrors.whatsappNumber = 'WhatsApp number is required';
    } else if (!/^\+?[\d\s-()]{10,15}$/.test(formData.whatsappNumber.trim())) {
      newErrors.whatsappNumber = 'Please enter a valid WhatsApp number';
    }

    if (!formData.address.trim()) {
      newErrors.address = 'Address is required';
    } else if (formData.address.trim().length < 10) {
      newErrors.address = 'Please provide a complete address (minimum 10 characters)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      await onSubmit({
        fullName: formData.fullName.trim(),
        whatsappNumber: formData.whatsappNumber.trim(),
        address: formData.address.trim()
      });
      
      // Reset form on successful submission
      setFormData({
        fullName: '',
        whatsappNumber: '',
        address: ''
      });
      setErrors({});
    } catch (error) {
      console.error('Error submitting claim:', error);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  if (!isOpen || !prize) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-gradient-blue-dark glass-card glass-border rounded-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-300">
        {/* Header */}
        <div className="bg-gradient-glass-blue px-6 py-4 glass-border-bottom">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Gift className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Claim Your Reward</h3>
                <p className="text-sm text-blue-200">{prize.name}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="p-2 hover:bg-white/10 rounded-lg glass-transition disabled:opacity-50"
            >
              <X className="w-5 h-5 text-gray-300" />
            </button>
          </div>
        </div>

        {/* Prize Info */}
        <div className="px-6 py-4 bg-gradient-glass border-b border-white/10">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-xl overflow-hidden bg-white/5">
              <Image
                src={prize.imageUrl}
                alt={prize.name}
                width={64}
                height={64}
                className="object-cover"
              />
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-white">{prize.name}</h4>
              <p className="text-sm text-gray-300 mt-1">{prize.description}</p>
              <div className="flex items-center mt-2">
                <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded-full border border-yellow-500/30">
                  {prize.pointsRequired} Points
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
          <p className="text-sm text-gray-300 text-center">
            Please provide your details to claim this reward. Our team will contact you for delivery.
          </p>

          {/* Full Name */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-white">
              <User className="w-4 h-4 inline mr-2" />
              Full Name *
            </label>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => handleInputChange('fullName', e.target.value)}
              placeholder="Enter your full name"
              className={`w-full px-4 py-3 bg-white/5 border rounded-xl text-white placeholder-gray-400 glass-transition focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 ${
                errors.fullName ? 'border-red-500/50' : 'border-white/20'
              }`}
              disabled={isSubmitting}
            />
            {errors.fullName && (
              <p className="text-sm text-red-400">{errors.fullName}</p>
            )}
          </div>

          {/* WhatsApp Number */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-white">
              <Phone className="w-4 h-4 inline mr-2" />
              WhatsApp Number *
            </label>
            <input
              type="tel"
              value={formData.whatsappNumber}
              onChange={(e) => handleInputChange('whatsappNumber', e.target.value)}
              placeholder="+92 300 1234567"
              className={`w-full px-4 py-3 bg-white/5 border rounded-xl text-white placeholder-gray-400 glass-transition focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 ${
                errors.whatsappNumber ? 'border-red-500/50' : 'border-white/20'
              }`}
              disabled={isSubmitting}
            />
            {errors.whatsappNumber && (
              <p className="text-sm text-red-400">{errors.whatsappNumber}</p>
            )}
          </div>

          {/* Address */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-white">
              <MapPin className="w-4 h-4 inline mr-2" />
              Delivery Address *
            </label>
            <textarea
              value={formData.address}
              onChange={(e) => handleInputChange('address', e.target.value)}
              placeholder="Enter your complete address including city and postal code"
              rows={3}
              className={`w-full px-4 py-3 bg-white/5 border rounded-xl text-white placeholder-gray-400 glass-transition focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 resize-none ${
                errors.address ? 'border-red-500/50' : 'border-white/20'
              }`}
              disabled={isSubmitting}
            />
            {errors.address && (
              <p className="text-sm text-red-400">{errors.address}</p>
            )}
          </div>

          {/* Submit Button */}
          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl glass-transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl glass-transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <Gift className="w-4 h-4" />
                  <span>Submit Claim</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Footer Note */}
        <div className="px-6 py-4 bg-gradient-glass-dark border-t border-white/10">
          <p className="text-xs text-gray-400 text-center">
            Your claim will be reviewed by our admin team. You&apos;ll be contacted within 24-48 hours.
          </p>
        </div>
      </div>
    </div>
  );
}