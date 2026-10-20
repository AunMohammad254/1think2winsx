'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Check, Loader2 } from 'lucide-react';
import { getSupabaseMediaForPicker, type PickerImage } from '@/actions/media-actions';
import { isAllowedPrizeImageUrl } from '@/lib/cloudinary';
import { MEDIA_BUCKETS, mediaImageLoader } from '@/lib/media/config';

const SECTIONS = [
    { bucket: MEDIA_BUCKETS.prize, title: 'Prize images' },
    { bucket: MEDIA_BUCKETS.site, title: 'Site images' },
] as const;

interface PrizeImageLibraryProps {
    /** The prize's current image URL, marked as selected */
    selectedUrl: string;
    onSelect: (url: string) => void;
}

/**
 * Images already in Supabase Storage (prize-images, then site-media, newest first) for the prize
 * form to reuse. Only images the prize form accepts are listed. Loads afresh each time it opens.
 */
export default function PrizeImageLibrary({ selectedUrl, onSelect }: PrizeImageLibraryProps) {
    const [images, setImages] = useState<PickerImage[] | null>(null);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        (async () => {
            let res: Awaited<ReturnType<typeof getSupabaseMediaForPicker>>;
            try {
                res = await getSupabaseMediaForPicker();
            } catch {
                res = { success: false, error: 'Could not load images' };
            }
            if (res.success) setImages(res.images.filter((img) => isAllowedPrizeImageUrl(img.url)));
            else setError(res.error);
        })();
    }, [attempt]);

    const retry = () => {
        setError('');
        setAttempt((n) => n + 1);
    };

    let body: React.ReactNode;
    if (error) {
        body = (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4">
                <p role="alert" className="text-sm text-red-400">{error}</p>
                <button
                    type="button"
                    onClick={retry}
                    className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-medium text-white transition-colors"
                >
                    Try again
                </button>
            </div>
        );
    } else if (!images) {
        body = (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Loading images…
            </div>
        );
    } else if (images.length === 0) {
        body = <p className="py-6 text-center text-sm text-gray-400">No images in storage yet. Use Upload to add one.</p>;
    } else {
        body = SECTIONS.map(({ bucket, title }) => {
            const inBucket = images.filter((img) => img.bucket === bucket);
            if (inBucket.length === 0) return null;
            return (
                <section key={bucket} aria-label={title}>
                    <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                        {title} ({inBucket.length})
                    </h4>
                    <ul className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                        {inBucket.map((img) => {
                            const selected = img.url === selectedUrl;
                            return (
                                <li key={img.url}>
                                    <button
                                        type="button"
                                        onClick={() => onSelect(img.url)}
                                        aria-label={`Use ${img.name}`}
                                        aria-pressed={selected}
                                        title={img.name}
                                        className={`relative block w-full aspect-square rounded-lg overflow-hidden bg-slate-700/50 border-2 transition-colors focus:outline-none focus-visible:border-blue-400 ${selected ? 'border-blue-500' : 'border-transparent hover:border-white/30'}`}
                                    >
                                        <Image
                                            src={img.url}
                                            loader={mediaImageLoader}
                                            alt=""
                                            fill
                                            sizes="96px"
                                            className="object-cover"
                                        />
                                        {selected && (
                                            <span className="absolute top-1 right-1 rounded-full bg-blue-500 p-0.5">
                                                <Check className="w-3 h-3 text-white" aria-hidden="true" />
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            );
        });
    }

    return (
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-sm font-medium text-gray-200">Choose from library</p>
                {/* A new tab, so the half-filled prize form stays as it is */}
                <Link
                    href="/admin/media"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300"
                >
                    Manage images
                </Link>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-4 pr-1">{body}</div>
        </div>
    );
}
