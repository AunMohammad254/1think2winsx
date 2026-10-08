/**
 * Notification Database Operations
 */

import { getDb, getAdminDb, generateId, fetchAllByKeyset, mapWithConcurrency } from './shared'
import webpush from 'web-push'
import logger from '@/lib/logger'

// Configure web-push with VAPID keys if they are available
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:contact@1think2wins.com';

if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(
        vapidSubject,
        vapidPublicKey,
        vapidPrivateKey
    );
} else {
    console.warn('[Web Push] VAPID keys are missing from environment variables.');
}

const PUSH_SEND_TIMEOUT_MS = 10_000;
// `.in('userId', [...])` puts the ids in the URL. UUIDs are ~37 chars each, and gateways reject
// request lines past ~8 KB, so look subscriptions up for at most this many users per request.
const USER_ID_LOOKUP_CHUNK = 120;

/** All push subscriptions for the given users (chunked lookups, every page of each). */
async function fetchSubscriptionsForUsers(userIds: string[]): Promise<PushSubscriptionRecord[]> {
    const adminDb = getAdminDb();
    const chunks: string[][] = [];
    for (let i = 0; i < userIds.length; i += USER_ID_LOOKUP_CHUNK) {
        chunks.push(userIds.slice(i, i + USER_ID_LOOKUP_CHUNK));
    }
    const perChunk = await mapWithConcurrency(chunks, 4, (chunk) =>
        fetchAllByKeyset<PushSubscriptionRecord>(
            (after, limit) => {
                let q = adminDb.from('PushSubscription').select('*').in('userId', chunk);
                if (after) q = q.gt('id', after);
                return q.order('id', { ascending: true }).limit(limit);
            },
            (s) => s.id,
        )
    );
    return perChunk.flat();
}

interface PushPayload {
    title: string;
    body: string;
    url: string;
    icon?: string;
    badge?: string;
    tag?: string;
    renotify?: boolean;
}

/** Shape of a row from the PushSubscription table */
interface PushSubscriptionRecord {
    id: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    createdAt: string;
}

async function sendWebPush(subscription: PushSubscriptionRecord, payload: PushPayload) {
    try {
        const pushSub = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
            }
        };
        // Without a timeout one unresponsive push-service socket stalls its whole batch (and the
        // batches after it) for as long as the OS keeps the connection open.
        await webpush.sendNotification(pushSub, JSON.stringify(payload), { timeout: PUSH_SEND_TIMEOUT_MS });
    } catch (error: unknown) {
        const pushError = error as { statusCode?: number };
        // If the subscription is no longer valid, delete it (HTTP 410 Gone / 404 Not Found)
        if (pushError.statusCode === 410 || pushError.statusCode === 404) {
            logger.log(`[Web Push] Subscription expired/invalid (${pushError.statusCode}). Deleting subscription with ID ${subscription.id}`);
            try {
                const adminDb = getAdminDb();
                await adminDb
                    .from('PushSubscription')
                    .delete()
                    .eq('id', subscription.id);
            } catch (delError) {
                console.error('[Web Push] Failed to delete expired subscription:', delError);
            }
        } else {
            console.error('[Web Push] Failed to send push notification:', error);
        }
    }
}

export interface Notification {
    id: string;
    userId: string;
    title: string;
    message: string;
    type: string;
    read: boolean;
    link: string | null;
    createdAt: string;
    updatedAt: string;
}

export const notificationDb = {
    async getUserNotifications(userId: string, limit = 50): Promise<Notification[]> {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Notification')
            .select('*')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })
            .limit(limit)

        if (error) throw error
        return (data || []) as Notification[]
    },

    async getUnreadCount(userId: string): Promise<number> {
        const supabase = await getDb()
        const { count, error } = await supabase
            .from('Notification')
            .select('*', { count: 'exact', head: true })
            .eq('userId', userId)
            .eq('read', false)

        if (error) throw error
        return count || 0
    },

    async markAsRead(notificationId: string, userId: string): Promise<void> {
        const supabase = await getDb()
        const { error } = await supabase
            .from('Notification')
            .update({ read: true, updatedAt: new Date().toISOString() })
            .eq('id', notificationId)
            .eq('userId', userId)

        if (error) throw error
    },

    async markAllAsRead(userId: string): Promise<void> {
        const supabase = await getDb()
        const { error } = await supabase
            .from('Notification')
            .update({ read: true, updatedAt: new Date().toISOString() })
            .eq('userId', userId)
            .eq('read', false)

        if (error) throw error
    },

    async create(userId: string, data: { title: string; message: string; type: string; link?: string }) {
        const supabase = await getDb()
        const { data: record, error } = await supabase
            .from('Notification')
            .insert({
                id: generateId(),
                userId,
                title: data.title,
                message: data.message,
                type: data.type,
                link: data.link || null,
                read: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })
            .select()
            .single()

        if (error) throw error

        // Dispatch web push notification in the background
        const adminDb = getAdminDb()
        const { data: subs } = await adminDb
            .from('PushSubscription')
            .select('*')
            .eq('userId', userId)

        if (subs && subs.length > 0) {
            const payload: PushPayload = {
                title: data.title,
                body: data.message,
                url: data.link || '/notifications',
                icon: '/Favicon/apple-touch-icon.png',
                badge: '/Favicon/favicon.ico',
                tag: data.type,
                renotify: true,
            }
            // Trigger web push sending without blocking the main DB insert response
            Promise.allSettled(subs.map((sub: PushSubscriptionRecord) => sendWebPush(sub, payload))).catch(e => {
                console.error('[Web Push] Error sending to user subscriptions:', e);
            });
        }

        return record as Notification
    },

    async createBroadcast(data: { title: string; message: string; type: string; link?: string }): Promise<void> {
        const adminDb = getAdminDb()

        // 1. Fetch all user IDs. Keyset pagination in primary-key order: the old offset paging
        // had no ORDER BY, so concurrent signups could make it skip or repeat users.
        const users = await fetchAllByKeyset<{ id: string }>(
            (after, limit) => {
                let q = adminDb.from('User').select('id');
                if (after) q = q.gt('id', after);
                return q.order('id', { ascending: true }).limit(limit);
            },
            (u) => u.id,
        );
        const allUserIds = users.map((u) => u.id);

        if (allUserIds.length === 0) return;

        const now = new Date().toISOString();

        // 2. Insert notifications in chunks of 500 rows to stay within Supabase limits
        const INSERT_CHUNK = 500;
        for (let i = 0; i < allUserIds.length; i += INSERT_CHUNK) {
            const chunk = allUserIds.slice(i, i + INSERT_CHUNK);
            const notifications = chunk.map((uid: string) => ({
                id: generateId(),
                userId: uid,
                title: data.title,
                message: data.message,
                type: data.type,
                link: data.link || null,
                read: false,
                createdAt: now,
                updatedAt: now,
            }));

            const { error: insertError } = await adminDb
                .from('Notification')
                .insert(notifications);

            if (insertError) throw insertError;
        }

        // 3. Fetch ALL push subscriptions (every page: a plain select('*') is silently capped at
        // PostgREST's 1,000-row limit, so only the first thousand subscribers were ever pushed)
        // and broadcast web pushes. A failure here must not fail the broadcast: the in-app
        // notifications above are already stored.
        let subs: PushSubscriptionRecord[] = [];
        try {
            subs = await fetchAllByKeyset<PushSubscriptionRecord>(
                (after, limit) => {
                    let q = adminDb.from('PushSubscription').select('*');
                    if (after) q = q.gt('id', after);
                    return q.order('id', { ascending: true }).limit(limit);
                },
                (s) => s.id,
            );
        } catch (subError) {
            console.error('[Web Push] Failed to load push subscriptions for broadcast:', subError);
        }

        if (subs.length > 0) {
            const payload: PushPayload = {
                title: data.title,
                body: data.message,
                url: data.link || '/notifications',
                icon: '/Favicon/apple-touch-icon.png',
                badge: '/Favicon/favicon.ico',
                tag: data.type,
                renotify: true,
            };
            
            // Dispatch in small batches of 50 to avoid network bottlenecks
            const batchSize = 50;
            (async () => {
                for (let i = 0; i < subs.length; i += batchSize) {
                    const batch = subs.slice(i, i + batchSize);
                    await Promise.allSettled(batch.map((sub: PushSubscriptionRecord) => sendWebPush(sub, payload)));
                }
            })().catch(e => {
                console.error('[Web Push] Error during broadcast sending:', e);
            });
        }
    },

    // Create a batch notification for specific users
    async createBatchForUsers(userIds: string[], data: { title: string; message: string; type: string; link?: string }) {
        if (!userIds || userIds.length === 0) return;
        
        const adminDb = getAdminDb();
        const now = new Date().toISOString();

        // 1. Insert notifications in chunks of 500 rows to stay within Supabase limits
        const INSERT_CHUNK = 500;
        for (let i = 0; i < userIds.length; i += INSERT_CHUNK) {
            const chunk = userIds.slice(i, i + INSERT_CHUNK);
            const notifications = chunk.map((uid: string) => ({
                id: generateId(),
                userId: uid,
                title: data.title,
                message: data.message,
                type: data.type,
                link: data.link || null,
                read: false,
                createdAt: now,
                updatedAt: now,
            }));

            const { error: insertError } = await adminDb
                .from('Notification')
                .insert(notifications);

            if (insertError) throw insertError;
        }

        // 2. Fetch push subscriptions for these users and broadcast web pushes. The lookup is
        // chunked (thousands of ids in one `.in()` overflow the request URL and the 1,000-row cap)
        // and a failure is logged instead of silently dropped.
        let subs: PushSubscriptionRecord[] = [];
        try {
            subs = await fetchSubscriptionsForUsers(userIds);
        } catch (subError) {
            console.error('[Web Push] Failed to load push subscriptions for batch:', subError);
        }

        if (subs.length > 0) {
            const payload: PushPayload = {
                title: data.title,
                body: data.message,
                url: data.link || '/notifications',
                icon: '/Favicon/apple-touch-icon.png',
                badge: '/Favicon/favicon.ico',
                tag: data.type,
                renotify: true,
            };
            
            // Dispatch in small batches of 50 to avoid network bottlenecks
            const batchSize = 50;
            (async () => {
                for (let i = 0; i < subs.length; i += batchSize) {
                    const batch = subs.slice(i, i + batchSize);
                    await Promise.allSettled(batch.map((sub: PushSubscriptionRecord) => sendWebPush(sub, payload)));
                }
            })().catch(e => {
                console.error('[Web Push] Error during batch sending:', e);
            });
        }
    },

    // Save browser push subscription
    async savePushSubscription(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PushSubscription')
            .upsert({
                id: generateId(),
                userId,
                endpoint: subscription.endpoint,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth,
                createdAt: new Date().toISOString()
            }, {
                onConflict: 'endpoint'
            })
            .select()
            .single()

        if (error) throw error
        return data
    },

    // Delete browser push subscription
    async deletePushSubscription(userId: string, endpoint: string) {
        const supabase = await getDb()
        const { error } = await supabase
            .from('PushSubscription')
            .delete()
            .eq('endpoint', endpoint)
            .eq('userId', userId)

        if (error) throw error
    },

    // Save a scheduled notification
    async scheduleNotification(data: {
        title: string;
        message: string;
        type: string;
        link?: string;
        targetType: string;
        targetUserId?: string;
        scheduledAt: string;
    }): Promise<any> {
        const adminDb = getAdminDb();
        const { data: record, error } = await adminDb
            .from('ScheduledNotification')
            .insert({
                id: generateId(),
                title: data.title,
                message: data.message,
                type: data.type,
                link: data.link || null,
                targetType: data.targetType,
                targetUserId: data.targetUserId || null,
                scheduledAt: new Date(data.scheduledAt).toISOString(),
                dispatched: false,
                createdAt: new Date().toISOString()
            })
            .select()
            .single();

        if (error) throw error;
        return record;
    },

    // Delete a single notification for a user (RLS-protected)
    async deleteNotification(notificationId: string, userId: string): Promise<void> {
        const supabase = await getDb()
        const { error } = await supabase
            .from('Notification')
            .delete()
            .eq('id', notificationId)
            .eq('userId', userId)

        if (error) throw error
    },

    // Delete all notifications for a user
    async deleteAllNotifications(userId: string): Promise<void> {
        const supabase = await getDb()
        const { error } = await supabase
            .from('Notification')
            .delete()
            .eq('userId', userId)

        if (error) throw error
    }
}

