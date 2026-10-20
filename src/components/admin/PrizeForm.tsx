'use client';

import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import type { Prize, PrizeFormData, PrizeCategoryValue, PrizeStatus } from '@/types/prize';
import Image from 'next/image';
import { toast } from 'sonner';
import { Images, Loader2, Upload, X } from 'lucide-react';
import { isAllowedPrizeImageUrl, PRIZE_IMAGE_URL_HINT } from '@/lib/cloudinary';
import {
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_ERROR,
    UPLOAD_IMAGE_TYPES,
    UPLOAD_IMAGE_TYPES_ERROR,
} from '@/lib/media/config';
import PrizeImageLibrary from './PrizeImageLibrary';

// Form validation schema. An emptied number field is NaN, which z.number() reports as its type error.
const prizeFormSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    description: z.string().max(500, 'Description too long').optional(),
    imageUrl: z.string().refine(isAllowedPrizeImageUrl, PRIZE_IMAGE_URL_HINT).optional().or(z.literal('')),
    modelUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
    type: z.string().min(1, 'Type is required'),
    pointsRequired: z.number({ error: 'Enter a number' }).int('Points must be a whole number').min(1, 'Points must be at least 1'),
    category: z.enum(['electronics', 'vehicles', 'accessories', 'general', 'bumper']),
    stock: z.number({ error: 'Enter a number' }).int('Stock must be a whole number').min(0, 'Stock cannot be negative'),
    status: z.enum(['draft', 'published']),
    value: z.number({ error: 'Enter a number' }).min(0, 'Value cannot be negative'),
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
    const [isUploading, setIsUploading] = useState(false);
    const [showLibrary, setShowLibrary] = useState(false);
    // The last image URL that failed to load, so the preview falls back to the placeholder
    // instead of retrying it on every render
    const [brokenImage, setBrokenImage] = useState('');
    const fileInput = useRef<HTMLInputElement>(null);

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
            category: (prize?.category as PrizeCategoryValue) || 'general',
            stock: prize?.stock || 0,
            status: (prize?.status as PrizeStatus) || 'draft',
            value: prize?.value || 0,
        },
    });

    const imageUrl = watch('imageUrl') || '';
    // Only an image the prize can be saved with is previewed (and fetched)
    const previewUrl = imageUrl !== brokenImage && isAllowedPrizeImageUrl(imageUrl) ? imageUrl : '';

    const setImageUrl = (url: string) => setValue('imageUrl', url, { shouldValidate: true, shouldDirty: true });

    const handleFormSubmit = async (data: FormValues) => {
        await onSubmit({
            ...data,
            description: data.description || '',
            imageUrl: data.imageUrl || '',
            modelUrl: data.modelUrl || '',
        });
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Cleared so choosing the same file again (e.g. after a failed upload) fires onChange again
        e.target.value = '';
        if (!file) return;
        // The same checks /api/upload makes, before sending up to 10 MB for nothing
        if (!UPLOAD_IMAGE_TYPES.includes(file.type)) {
            toast.error(UPLOAD_IMAGE_TYPES_ERROR);
            return;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            toast.error(MAX_UPLOAD_ERROR);
            return;
        }

        try {
            setIsUploading(true);
            const formData = new FormData();
            formData.append('file', file);
            formData.append('target', 'prize');

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');

            // Resized to WebP and stored in Supabase Storage (prize-images bucket)
            setImageUrl(data.url);
            setShowLibrary(false);
        } catch (error) {
            console.error('Error uploading image:', error);
            toast.error((error as Error).message);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            {/* Header and footer stay put and the form scrolls between them, so nothing is pushed
                off screen on short viewports (a centred modal taller than the screen loses its top) */}
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="prize-form-title"
                className="relative flex flex-col w-full max-w-2xl max-h-full bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex shrink-0 items-center justify-between p-6 border-b border-white/10 bg-gradient-to-r from-blue-600/20 to-purple-600/20">
                    <div>
                        <h2 id="prize-form-title" className="text-xl font-bold text-white">
                            {prize ? 'Edit Prize' : 'Create New Prize'}
                        </h2>
                        <p className="text-sm text-gray-400">
                            {prize ? 'Update prize details' : 'Add a new prize for redemption'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="p-2 rounded-full hover:bg-white/10 transition-colors"
                    >
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit(handleFormSubmit)} className="flex-1 min-h-0 p-6 space-y-6 overflow-y-auto">
                    {/* Image: upload, pick from the library, or paste a link */}
                    <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                            <div className="relative w-32 h-32 self-center sm:self-start rounded-xl bg-slate-700/50 border border-white/10 overflow-hidden flex-shrink-0">
                                {previewUrl ? (
                                    <Image
                                        src={previewUrl}
                                        alt="Preview"
                                        fill
                                        unoptimized
                                        sizes="128px"
                                        className="object-cover"
                                        onError={() => setBrokenImage(previewUrl)}
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-4xl text-gray-500">
                                        🎁
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0 space-y-3">
                                <label htmlFor="prizeImageUrl" className="block text-sm font-medium text-gray-300">
                                    Prize Image
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    <input
                                        ref={fileInput}
                                        type="file"
                                        accept={UPLOAD_IMAGE_TYPES.join(',')}
                                        className="hidden"
                                        tabIndex={-1}
                                        aria-label="Upload prize image"
                                        onChange={handleImageUpload}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => fileInput.current!.click()}
                                        disabled={isUploading}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isUploading ? (
                                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                        ) : (
                                            <Upload className="w-4 h-4" aria-hidden="true" />
                                        )}
                                        {isUploading ? 'Uploading...' : 'Upload'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowLibrary((open) => !open)}
                                        aria-expanded={showLibrary}
                                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${showLibrary
                                            ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                            : 'bg-slate-700/50 text-gray-200 border-white/10 hover:border-white/20'
                                            }`}
                                    >
                                        <Images className="w-4 h-4" aria-hidden="true" />
                                        Choose from library
                                    </button>
                                    {imageUrl && (
                                        <button
                                            type="button"
                                            onClick={() => setImageUrl('')}
                                            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-white/5 transition-colors"
                                        >
                                            <X className="w-4 h-4" aria-hidden="true" />
                                            Remove
                                        </button>
                                    )}
                                </div>
                                <input
                                    id="prizeImageUrl"
                                    type="text"
                                    {...register('imageUrl')}
                                    className="w-full px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                                    placeholder="Upload an image, or paste an image link"
                                />
                                {errors.imageUrl && (
                                    <p className="text-xs text-red-400">{errors.imageUrl.message}</p>
                                )}
                            </div>
                        </div>
                        {showLibrary && (
                            <PrizeImageLibrary
                                selectedUrl={imageUrl}
                                onSelect={(url) => {
                                    setImageUrl(url);
                                    setShowLibrary(false);
                                }}
                            />
                        )}
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                                <option value="bumper" className="bg-slate-800">Bumper (secret: hidden from players)</option>
                            </select>
                        </div>
                    </div>

                    {/* Points & Value */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
