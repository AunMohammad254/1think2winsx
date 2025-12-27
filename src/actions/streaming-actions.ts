'use server';

/**
 * Server Actions for Live Stream Configuration
 * Uses Supabase RPC functions for database-only storage
 * 
 * These actions are designed for Next.js 16+ Server Components
 * and can be called directly from Client Components.
 */

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

// ============================================================
// Types
// ============================================================

export interface StreamConfig {
    success: boolean;
    isActive: boolean;
    embedHtml: string;
    embedUrl: string | null;
    title: string;
    platform: 'youtube' | 'facebook' | 'twitch' | 'custom';
    updatedAt?: string;
    updatedBy?: string;
    message?: string;
    error?: string;
}

export interface UpdateStreamConfigInput {
    embedHtml?: string;
    embedUrl?: string;
    title?: string;
    platform?: 'youtube' | 'facebook' | 'twitch' | 'custom';
    isActive?: boolean;
}

interface ActionResult<T = void> {
    success: boolean;
    data?: T;
    error?: string;
}

// ============================================================
// Supabase Admin Client (Service Role for RPC calls)
// ============================================================

function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Supabase credentials not configured');
    }

    return createClient(supabaseUrl, supabaseServiceKey);
}

// ============================================================
// GET STREAM CONFIG
// ============================================================

/**
 * Fetches the current live stream configuration from the database.
 * This is a public read operation - no auth required.
 * 
 * Usage in Server Component:
 * ```tsx
 * const config = await getStreamConfig();
 * return <VideoPlayer initialConfig={config} />;
 * ```
 * 
 * Usage in Client Component:
 * ```tsx
 * const [config, setConfig] = useState<StreamConfig | null>(null);
 * useEffect(() => {
 *   getStreamConfig().then(setConfig);
 * }, []);
 * ```
 */
export async function getStreamConfig(): Promise<StreamConfig> {
    try {
        const supabase = getSupabaseAdmin();

        const { data, error } = await supabase.rpc('get_live_stream_config');

        if (error) {
            console.error('RPC error fetching stream config:', error);
            return {
                success: false,
                isActive: false,
                embedHtml: '',
                embedUrl: null,
                title: 'Livestream',
                platform: 'custom',
                error: error.message,
            };
        }

        if (!data?.success) {
            return {
                success: true,
                isActive: false,
                embedHtml: '',
                embedUrl: null,
                title: 'Livestream',
                platform: 'custom',
                message: data?.message || 'No stream configured',
            };
        }

        return {
            success: true,
            isActive: data.isActive ?? false,
            embedHtml: data.embedHtml ?? '',
            embedUrl: data.embedUrl ?? null,
            title: data.title ?? 'Livestream',
            platform: data.platform ?? 'custom',
            updatedAt: data.updatedAt,
            updatedBy: data.updatedBy,
        };
    } catch (err) {
        console.error('Error fetching stream config:', err);
        return {
            success: false,
            isActive: false,
            embedHtml: '',
            embedUrl: null,
            title: 'Livestream',
            platform: 'custom',
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}

// ============================================================
// UPDATE STREAM CONFIG
// ============================================================

/**
 * Updates the live stream configuration.
 * Admin-only operation - requires authentication via middleware.
 * 
 * @param input - Configuration to update
 * @param adminEmail - Email of admin making the change
 * 
 * Usage:
 * ```tsx
 * const result = await updateStreamConfig({
 *   embedHtml: '<iframe src="..."></iframe>',
 *   title: 'My Stream',
 *   platform: 'youtube',
 *   isActive: true
 * }, 'admin@example.com');
 * ```
 */
export async function updateStreamConfig(
    input: UpdateStreamConfigInput,
    adminEmail: string = 'admin'
): Promise<ActionResult<StreamConfig>> {
    try {
        // Validate input
        if (!input.embedHtml && !input.embedUrl) {
            return {
                success: false,
                error: 'Either embedHtml or embedUrl is required',
            };
        }

        // Validate embedHtml if provided
        if (input.embedHtml) {
            const trimmed = input.embedHtml.trim();
            if (trimmed.length < 10) {
                return {
                    success: false,
                    error: 'Embed HTML must be at least 10 characters',
                };
            }

            // Check for valid embed tags
            const hasValidTag = /<(iframe|video|embed|object)/i.test(trimmed);
            if (!hasValidTag) {
                return {
                    success: false,
                    error: 'Embed code must contain an iframe, video, embed, or object element',
                };
            }

            // Sanitize: remove script tags
            input.embedHtml = trimmed.replace(/<script[^>]*>.*?<\/script>/gis, '');
        }

        // Validate embedUrl if provided
        if (input.embedUrl) {
            try {
                const url = new URL(input.embedUrl);
                if (!['http:', 'https:'].includes(url.protocol)) {
                    return {
                        success: false,
                        error: 'Embed URL must be a valid HTTP/HTTPS URL',
                    };
                }
            } catch {
                return {
                    success: false,
                    error: 'Invalid embed URL format',
                };
            }
        }

        const supabase = getSupabaseAdmin();

        const { data, error } = await supabase.rpc('update_live_stream_config', {
            p_embed_html: input.embedHtml ?? null,
            p_embed_url: input.embedUrl ?? null,
            p_title: input.title ?? 'Livestream',
            p_platform: input.platform ?? 'custom',
            p_is_active: input.isActive ?? true,
            p_admin_email: adminEmail,
        });

        if (error) {
            console.error('RPC error updating stream config:', error);
            return {
                success: false,
                error: error.message,
            };
        }

        if (!data?.success) {
            return {
                success: false,
                error: data?.error || 'Failed to update stream configuration',
            };
        }

        // Revalidate cached data
        revalidatePath('/admin/streaming');
        revalidatePath('/quiz');
        revalidatePath('/');

        return {
            success: true,
            data: {
                success: true,
                isActive: data.isActive,
                embedHtml: data.embedHtml,
                embedUrl: data.embedUrl,
                title: data.title,
                platform: data.platform,
                updatedAt: data.updatedAt,
                updatedBy: data.updatedBy,
            },
        };
    } catch (err) {
        console.error('Error updating stream config:', err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}

// ============================================================
// TOGGLE STREAM STATUS
// ============================================================

/**
 * Toggles the stream active/inactive status.
 * Admin-only operation.
 * 
 * @param isActive - New active state
 * @param adminEmail - Email of admin making the change
 */
export async function toggleStreamStatus(
    isActive: boolean,
    adminEmail: string = 'admin'
): Promise<ActionResult<{ isActive: boolean }>> {
    try {
        const supabase = getSupabaseAdmin();

        const { data, error } = await supabase.rpc('toggle_stream_status', {
            p_is_active: isActive,
            p_admin_email: adminEmail,
        });

        if (error) {
            console.error('RPC error toggling stream status:', error);
            return {
                success: false,
                error: error.message,
            };
        }

        if (!data?.success) {
            return {
                success: false,
                error: data?.error || 'Failed to toggle stream status',
            };
        }

        // Revalidate cached data
        revalidatePath('/admin/streaming');
        revalidatePath('/quiz');
        revalidatePath('/');

        return {
            success: true,
            data: { isActive: data.isActive },
        };
    } catch (err) {
        console.error('Error toggling stream status:', err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}
