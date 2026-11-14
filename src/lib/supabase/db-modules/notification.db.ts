/**
 * Notification Database Operations
 */

import { getDb, getAdminDb, generateId, fetchAllByKeyset, mapWithConcurrency } from './shared'
import webpush from 'web-push'
import logger from '@/lib/logger'
import { groupBy } from '@/lib/group-by'
import { CONTACT_EMAIL } from '@/lib/site-contact'

// Configure web-push with VAPID keys if they are available
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || `mailto:${CONTACT_EMAIL}`;

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

type BroadcastInput = { title: string; message: string; type: string; link?: string };

/** queued: a Broadcast job carries it (the migration is applied); duplicate: the same one went out minutes ago. */
export interface BroadcastOutcome {
    id: string | null;
    duplicate: boolean;
    queued: boolean;
}

/** What one run of advanceBroadcasts did. */
export interface BroadcastProgress {
    broadcasts: string[];
    inserted: number;
    pushed: number;
}

interface ClaimedBroadcast {
    id: string;
    token: string;
    status: 'inserting' | 'pushing';
    title: string;
    message: string;
    type: string;
    link: string | null;
    pushCursor: string | null;
}

/** PostgREST's answer for a function it doesn't know: migration 20261113120000 is not applied yet. */
const isMissingFunction = (error: unknown) => (error as { code?: string } | null)?.code === 'PGRST202';

function envInt(name: string, fallback: number, min: number, max: number): number {
    const n = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Players given the notice per database call: one INSERT ... SELECT, well inside the 8 s statement limit
const BROADCAST_INSERT_CHUNK = 5_000;
// How long a run holds a broadcast; one whose run died is picked up again after this
const BROADCAST_LEASE_SECONDS = 300;
const BROADCAST_PUSH_CONCURRENCY = 50;
const BROADCAST_BUDGET_MS = 40_000;
/**
 * Devices pushed per wave, and the gap between waves. Each push tap opens the site, so the default
 * (2,000 a minute, about 33 a second) keeps the taps well under what Hostinger takes. Raise it only
 * with an event's numbers: 20,000 subscribed devices take 10 minutes at the default.
 */
const pushWaveSize = () => envInt('BROADCAST_PUSH_WAVE', 2_000, 50, 50_000);
const waveGapSeconds = () => envInt('BROADCAST_WAVE_SECONDS', 60, 0, 3_600);

function broadcastPayload(data: { title: string; message: string; type: string; link?: string | null }): PushPayload {
    return {
        title: data.title,
        body: data.message,
        url: data.link || '/notifications',
        icon: '/Favicon/apple-touch-icon.png',
        badge: '/Favicon/favicon.ico',
        tag: data.type,
        renotify: true,
    };
}

/** The next wave of devices after the broadcast's cursor, pushed 50 at a time. */
async function pushWave(broadcast: ClaimedBroadcast): Promise<{ cursor: string | null; sent: number; last: boolean }> {
    const adminDb = getAdminDb();
    const size = pushWaveSize();
    const subs: PushSubscriptionRecord[] = [];
    let after = broadcast.pushCursor;
    let last = false;
    while (subs.length < size) {
        const limit = Math.min(1_000, size - subs.length);
        let q = adminDb.from('PushSubscription').select('*');
        if (after) q = q.gt('id', after);
        const { data, error } = await q.order('id', { ascending: true }).limit(limit);
        if (error) throw error;
        const page = (data ?? []) as PushSubscriptionRecord[];
        subs.push(...page);
        if (page.length < limit) {
            last = true;
            break;
        }
        after = page[page.length - 1].id;
    }
    const payload = broadcastPayload(broadcast);
    // sendWebPush never throws: a dead subscription is deleted, any other failure is logged
    await mapWithConcurrency(subs, BROADCAST_PUSH_CONCURRENCY, (sub) => sendWebPush(sub, payload));
    return { cursor: subs.length > 0 ? subs[subs.length - 1].id : broadcast.pushCursor, sent: subs.length, last };
}

/**
 * Moves the broadcasts that are due forward, for up to `budgetMs`: every remaining player's notice
 * first, then one wave of pushes. Each broadcast is held by one run at a time (a 5-minute lease), so
 * the minute cron and the in-process loop can both call it. A run that dies leaves the job where it
 * stopped: notices are never doubled; a push wave cut off part-way is sent again after the lease, and
 * its tag makes the second copy replace the first on the device.
 */
async function advanceBroadcasts({ budgetMs = BROADCAST_BUDGET_MS }: { budgetMs?: number } = {}): Promise<BroadcastProgress> {
    const adminDb = getAdminDb();
    const deadline = Date.now() + budgetMs;
    const progress: BroadcastProgress = { broadcasts: [], inserted: 0, pushed: 0 };
    while (Date.now() < deadline) {
        const { data, error } = await adminDb.rpc('broadcast_claim', { p_lease_seconds: BROADCAST_LEASE_SECONDS });
        if (error) {
            if (isMissingFunction(error)) return progress;
            throw error;
        }
        if (!data) return progress;
        const broadcast = data as ClaimedBroadcast;
        progress.broadcasts.push(broadcast.id);

        let status = broadcast.status;
        while (status === 'inserting') {
            if (Date.now() >= deadline) {
                // Out of time: hand it back so the next run carries on at once
                await adminDb.rpc('broadcast_release', { p_id: broadcast.id, p_token: broadcast.token });
                return progress;
            }
            const { data: step, error: stepError } = await adminDb.rpc('broadcast_insert_users', {
                p_id: broadcast.id,
                p_limit: BROADCAST_INSERT_CHUNK,
            });
            const result = step as { success: boolean; inserted?: number; done?: boolean } | null;
            if (stepError || !result?.success) throw stepError ?? new Error(`Broadcast ${broadcast.id} could not add its notices`);
            progress.inserted += result.inserted ?? 0;
            if (result.done) status = 'pushing';
        }

        const wave = await pushWave(broadcast);
        progress.pushed += wave.sent;
        const { error: doneError } = await adminDb.rpc('broadcast_wave_done', {
            p_id: broadcast.id,
            p_token: broadcast.token,
            p_cursor: wave.cursor,
            p_sent: wave.sent,
            p_last: wave.last,
            p_next_wave_seconds: waveGapSeconds(),
        });
        if (doneError) throw doneError;
        logger.log(`[Broadcast] ${broadcast.id}: ${wave.sent} pushes in this wave${wave.last ? ', all sent' : ''}`);
    }
    return progress;
}

/** The whole job in the caller's request, as before migration 20261113120000 (and with FANOUT_V2=false). */
async function legacyBroadcast(data: BroadcastInput): Promise<void> {
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
        void (async () => {
            for (let i = 0; i < subs.length; i += batchSize) {
                const batch = subs.slice(i, i + batchSize);
                await Promise.allSettled(batch.map((sub: PushSubscriptionRecord) => sendWebPush(sub, payload)));
            }
        })(); // only awaits allSettled, so it never rejects
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

    // Every caller is server code that has already checked admin or cron access (lucky draw, wallet
    // reviews, admin messages, scheduled jobs). The request's own client cannot be used: the admin
    // panel signs in with its own session, not as a Supabase admin, so the Notification insert policy
    // (`is_admin()`) refused every one of these notifications.
    async create(userId: string, data: { title: string; message: string; type: string; link?: string }) {
        const adminDb = getAdminDb()
        const { data: record, error } = await adminDb
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
            // Trigger web push sending without blocking the main DB insert response (allSettled never rejects)
            void Promise.allSettled(subs.map((sub: PushSubscriptionRecord) => sendWebPush(sub, payload)));
        }

        return record as Notification
    },

    // Several notifications, each with its own text (a wallet review tells every depositor their own
    // amount), saved in one insert per 500 rows with one push-subscription lookup for all their users,
    // instead of create()'s insert and lookup per notification. Same callers and access as create().
    async createMany(items: Array<{ userId: string; title: string; message: string; type: string; link?: string }>): Promise<void> {
        if (items.length === 0) return;

        const adminDb = getAdminDb();
        const now = new Date().toISOString();
        const INSERT_CHUNK = 500;
        for (let i = 0; i < items.length; i += INSERT_CHUNK) {
            const { error } = await adminDb
                .from('Notification')
                .insert(items.slice(i, i + INSERT_CHUNK).map((item) => ({
                    id: generateId(),
                    userId: item.userId,
                    title: item.title,
                    message: item.message,
                    type: item.type,
                    link: item.link || null,
                    read: false,
                    createdAt: now,
                    updatedAt: now,
                })));
            if (error) throw error;
        }

        const itemsByUser = groupBy(items, (item) => item.userId);
        let subs: PushSubscriptionRecord[] = [];
        try {
            subs = await fetchSubscriptionsForUsers([...itemsByUser.keys()]);
        } catch (subError) {
            console.error('[Web Push] Failed to load push subscriptions for notifications:', subError);
        }

        // Each subscription gets its own user's notifications, sent in the background like create()'s
        const sends = subs.flatMap((sub) => (itemsByUser.get(sub.userId) ?? [])
            .map((item) => sendWebPush(sub, {
                title: item.title,
                body: item.message,
                url: item.link || '/notifications',
                icon: '/Favicon/apple-touch-icon.png',
                badge: '/Favicon/favicon.ico',
                tag: item.type,
                renotify: true,
            })));
        void Promise.allSettled(sends);
    },

    /**
     * Tell every player: a notice in each bell and a push to every device. Since migration
     * 20261113120000 this writes one "Broadcast" job and returns: the notices are added and the pushes
     * sent by advanceBroadcasts, now and from the minute cron, so a restart part-way loses nothing and
     * the pushes go out in paced waves. The same broadcast again within 15 minutes (a double click, a
     * scheduler re-run) is refused as a duplicate. Before the migration, or with FANOUT_V2=false, it
     * does the whole job in this request, as it used to.
     */
    async createBroadcast(data: BroadcastInput): Promise<BroadcastOutcome> {
        if (process.env.FANOUT_V2 === 'false') {
            await legacyBroadcast(data);
            return { id: null, duplicate: false, queued: false };
        }
        const { data: created, error } = await getAdminDb().rpc('broadcast_create', {
            p_title: data.title,
            p_message: data.message,
            p_type: data.type,
            p_link: data.link || null,
        });
        if (error) {
            if (!isMissingFunction(error)) throw error;
            await legacyBroadcast(data);
            return { id: null, duplicate: false, queued: false };
        }
        const result = created as { success: boolean; id?: string; duplicate?: boolean; error?: string } | null;
        if (!result?.success || !result.id) throw new Error(result?.error || 'The broadcast was refused');
        if (result.duplicate) {
            logger.log(`[Broadcast] "${data.title}" was already sent in the last 15 minutes (${result.id}): not sent again`);
            return { id: result.id, duplicate: true, queued: true };
        }
        // Start now rather than at the next minute; the minute cron finishes whatever this run doesn't
        void advanceBroadcasts().catch((advanceError) => console.error('[Broadcast] Sending stopped; the minute cron resumes it:', advanceError));
        return { id: result.id, duplicate: false, queued: true };
    },

    /** Moves due broadcasts forward (see advanceBroadcasts). The minute cron calls it. */
    advanceBroadcasts: (options?: { budgetMs?: number }) => advanceBroadcasts(options),

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
            void (async () => {
                for (let i = 0; i < subs.length; i += batchSize) {
                    const batch = subs.slice(i, i + batchSize);
                    await Promise.allSettled(batch.map((sub: PushSubscriptionRecord) => sendWebPush(sub, payload)));
                }
            })(); // only awaits allSettled, so it never rejects
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

