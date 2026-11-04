import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { getAdminDb, notificationDb } from '@/lib/supabase/db';
import { isWalletEnabled } from '@/lib/wallet/service';

/** Most deposits one request may process. The wallet screen selects from a page of 50. */
const MAX_BULK_TRANSACTIONS = 100;

type WalletRpcResult = { success?: boolean; error?: string } | null;

/**
 * POST /api/admin/wallet-transactions/bulk-process
 * Approve or reject several deposits at once.
 *
 * Each deposit goes through the same database functions as the single PATCH: approve_wallet_transaction
 * and reject_wallet_transaction lock the row, refuse a deposit that is no longer pending, and change the
 * balance and the status in one transaction. So a double click, or two admins working the same queue,
 * credits a deposit once, and a deposit whose call failed can simply be tried again. (This route used to
 * read the balance, add the deposit and write the total back, without checking any write.)
 */
export async function POST(request: NextRequest) {
    try {
        const adminSession = await validateAdminSession();
        if (!adminSession.valid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const csrfValidation = await requireCSRFToken(request);
        if (csrfValidation) return csrfValidation;

        if (!await isWalletEnabled()) {
            return NextResponse.json(
                { error: 'Wallet feature is currently disabled', code: 'WALLET_DISABLED' },
                { status: 503 }
            );
        }

        const body = await request.json();
        const { transactionIds, action, notes } = body ?? {};

        if (!Array.isArray(transactionIds) || transactionIds.length === 0
            || !transactionIds.every((id) => typeof id === 'string' && id.length > 0)) {
            return NextResponse.json({ error: 'Transaction IDs array is required' }, { status: 400 });
        }

        if (action !== 'approve' && action !== 'reject') {
            return NextResponse.json({ error: 'Invalid action. Must be "approve" or "reject"' }, { status: 400 });
        }

        const ids = [...new Set(transactionIds as string[])];
        if (ids.length > MAX_BULK_TRANSACTIONS) {
            return NextResponse.json(
                { error: `At most ${MAX_BULK_TRANSACTIONS} transactions can be processed at once` },
                { status: 400 }
            );
        }

        const reason = typeof notes === 'string' && notes ? notes : null;
        const processedBy = adminSession.email || 'admin';
        const supabase = getAdminDb();

        // Who to notify, read before anything changes: a failed read stops the batch with nothing done
        const { data: rows, error: lookupError } = await supabase
            .from('WalletTransaction')
            .select('id, userId, amount')
            .in('id', ids);
        if (lookupError) throw lookupError;
        const byId = new Map(((rows || []) as { id: string; userId: string; amount: number }[]).map((r) => [r.id, r]));

        const results = { success: 0, failed: 0, errors: [] as string[] };

        // One at a time: each call is its own transaction, so one bad deposit never undoes the others
        for (const id of ids) {
            try {
                const { data, error } = action === 'approve'
                    ? await supabase.rpc('approve_wallet_transaction', { p_transaction_id: id, p_processed_by: processedBy })
                    : await supabase.rpc('reject_wallet_transaction', { p_transaction_id: id, p_processed_by: processedBy, p_reason: reason });

                const result = data as WalletRpcResult;
                if (error || !result?.success) {
                    results.failed++;
                    results.errors.push(`${id}: ${error?.message || result?.error || 'not processed'}`);
                    continue;
                }
                results.success++;
            } catch (err) {
                results.failed++;
                results.errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
                continue;
            }

            const tx = byId.get(id);
            if (!tx) continue;
            try {
                await notificationDb.create(tx.userId, action === 'approve'
                    ? {
                        title: 'Deposit Approved',
                        message: `Your deposit of ${tx.amount} PKR has been approved and added to your wallet.`,
                        type: 'wallet_deposit',
                        link: '/profile/wallet',
                    }
                    : {
                        title: 'Deposit Rejected',
                        message: `Your deposit of ${tx.amount} PKR was rejected. Reason: ${reason || 'Not provided'}`,
                        type: 'wallet_deposit',
                        link: '/profile/wallet',
                    });
            } catch (e) {
                console.error('Notification error:', e);
            }
        }

        return NextResponse.json({
            success: true,
            message: `Successfully processed ${results.success} transactions. ${results.failed} failed.`,
            results
        });

    } catch (error) {
        console.error('Error processing bulk transactions:', error);
        return NextResponse.json(
            { error: 'Failed to process bulk transactions' },
            { status: 500 }
        );
    }
}
