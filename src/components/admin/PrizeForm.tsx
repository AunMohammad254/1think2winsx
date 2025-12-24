'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import type { Prize, PrizeFormData, PrizeCategory, PrizeStatus } from '@/types/prize';

// Form validation schema
const prizeFormSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    description: z.string().max(500, 'Description too long').optional(),
    imageUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
    modelUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
    type: z.string().min(1, 'Type is required'),
    pointsRequired: z.number().min(1, 'Points must be at least 1'),
    category: z.enum(['electronics', 'vehicles', 'accessories', 'general']),
    stock: z.number().min(0, 'Stock cannot be negative'),
    status: z.enum(['draft', 'published']),
    value: z.number().min(0, 'Value cannot be negative'),
});

type FormValues = z.infer<typeof prizeFormSchema>;

interface PrizeFormProps {
    prize: Prize | null;
    onSubmit: (data: PrizeFormData) => Promise<void>;
    onClose: () => void;
    isSubmitting: boolean;
}

const PRIZE_TYPES = [
    { value: 'bike', label: 'Bike / Motorcycle' },
    { value: 'phone', label: 'Phone / Smartphone' },
    { value: 'earbuds', label: 'Earbuds / Headphones' },
    { value: 'watch', label: 'Watch / Smartwatch' },
    { value: 'laptop', label: 'Laptop / Computer' },
    { value: 'tablet', label: 'Tablet' },
    { value: 'gaming', label: 'Gaming Console' },
    { value: 'other', label: 'Other' },
];

export default function PrizeForm({
    prize,
    onSubmit,
    onClose,
    isSubmitting,
}: PrizeFormProps) {
    const [previewUrl, setPreviewUrl] = useState<string>(prize?.imageUrl || '');

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors },
    } = useForm<FormValues>({
        resolver: zodResolver(prizeFormSchema),
        defaultValues: {
            name: prize?.name || '',
            description: prize?.description || '',
            imageUrl: prize?.imageUrl || '',
            modelUrl: prize?.modelUrl || '',
            type: prize?.type || 'phone',
            pointsRequired: prize?.pointsRequired || 100,
            category: (prize?.category as PrizeCategory) || 'general',
            stock: prize?.stock || 0,
            status: (prize?.status as PrizeStatus) || 'draft',
            value: prize?.value || 0,
        },
    });

    const imageUrl = watch('imageUrl');

    useEffect(() => {
        if (imageUrl && imageUrl !== previewUrl) {
            setPreviewUrl(imageUrl);
        }
    }, [imageUrl, previewUrl]);

    const handleFormSubmit = async (data: FormValues) => {
        await onSubmit({
            ...data,
            description: data.description || '',
            imageUrl: data.imageUrl || '',
            modelUrl: data.modelUrl || '',
        });
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-2xl my-8 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10 bg-gradient-to-r from-blue-600/20 to-purple-600/20">
                    <div>
                        <h2 className="text-xl font-bold text-white">
                            {prize ? 'Edit Prize' : 'Create New Prize'}
                        </h2>
                        <p className="text-sm text-gray-400">
                            {prize ? 'Update prize details' : 'Add a new prize for redemption'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-white/10 transition-colors"
                    >
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit(handleFormSubmit)} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* Image Preview */}
                    <div className="flex items-start gap-6">
                        <div className="w-32 h-32 rounded-xl bg-slate-700/50 border border-white/10 overflow-hidden flex-shrink-0">
                            {previewUrl ? (
                                <img
                                    src={previewUrl}
                                    alt="Preview"
                                    className="w-full h-full object-cover"
                                    onError={() => setPreviewUrl('')}
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-4xl text-gray-500">
                                    🎁
                                </div>
                            )}
                        </div>
                        <div className="flex-1 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    Image URL
                                </label>
                                <input
                                    type="text"
                                    {...register('imageUrl')}
                                    className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                                    placeholder="https://example.com/image.jpg"
                                />
                                {errors.imageUrl && (
                                    <p className="mt-1 text-xs text-red-400">{errors.imageUrl.message}</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Prize Name *
                        </label>
                        <input
                            type="text"
                            {...register('name')}
                            className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                            placeholder="e.g., iPhone 15 Pro"
                        />
                        {errors.name && (
                            <p className="mt-1 text-xs text-red-400">{errors.name.message}</p>
                        )}
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Description
                        </label>
                        <textarea
                            {...register('description')}
                            rows={3}
                            className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                            placeholder="Brief description of the prize..."
                        />
                        {errors.description && (
                            <p className="mt-1 text-xs text-red-400">{errors.description.message}</p>
                        )}
                    </div>

                    {/* Type & Category */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Type *
                            </label>
                            <select
                                {...register('type')}
                                className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                            >
                                {PRIZE_TYPES.map((type) => (
                                    <option key={type.value} value={type.value} className="bg-slate-800">
                                        {type.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Category *
                            </label>
                            <select
                                {...register('category')}
                                className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                            >
                                <option value="electronics" className="bg-slate-800">Electronics</option>
                                <option value="vehicles" className="bg-slate-800">Vehicles</option>
                                <option value="accessories" className="bg-slate-800">Accessories</option>
                                <option value="general" className="bg-slate-800">General</option>
                            </select>
                        </div>
                    </div>

                    {/* Points & Value */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Points Required *
                            </label>
                            <input
                                type="number"
                                {...register('pointsRequired', { valueAsNumber: true })}
                                min={1}
                                className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="100"
                            />
                            {errors.pointsRequired && (
                                <p className="mt-1 text-xs text-red-400">{errors.pointsRequired.message}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Value (PKR)
                            </label>
                            <input
                                type="number"
                                {...register('value', { valueAsNumber: true })}
                                min={0}
                                className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="0"
                            />
                            {errors.value && (
                                <p className="mt-1 text-xs text-red-400">{errors.value.message}</p>
                            )}
                        </div>
                    </div>

                    {/* Stock & Status */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Stock Quantity
                            </label>
                            <input
                                type="number"
                                {...register('stock', { valueAsNumber: true })}
                                min={0}
                                className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="0"
                            />
                            {errors.stock && (
                                <p className="mt-1 text-xs text-red-400">{errors.stock.message}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Status
                            </label>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setValue('status', 'draft')}
                                    className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all ${watch('status') === 'draft'
                                        ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                        : 'bg-slate-700/50 text-gray-400 border border-white/10 hover:border-white/20'
                                        }`}
                                >
                                    📝 Draft
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setValue('status', 'published')}
                                    className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all ${watch('status') === 'published'
                                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                        : 'bg-slate-700/50 text-gray-400 border border-white/10 hover:border-white/20'
                                        }`}
                                >
                                    ✅ Published
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Model URL (Optional) */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            3D Model URL (Optional)
                        </label>
                        <input
                            type="text"
                            {...register('modelUrl')}
                            className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                            placeholder="https://example.com/model.glb"
                        />
                        {errors.modelUrl && (
                            <p className="mt-1 text-xs text-red-400">{errors.modelUrl.message}</p>
                        )}
                    </div>
                </form>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-6 border-t border-white/10 bg-slate-800/50">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-6 py-3 text-gray-400 font-medium rounded-xl hover:bg-white/5 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit(handleFormSubmit)}
                        disabled={isSubmitting}
                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSubmitting ? (
                            <>
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Saving...
                            </>
                        ) : prize ? (
                            'Update Prize'
                        ) : (
                            'Create Prize'
                        )}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}
