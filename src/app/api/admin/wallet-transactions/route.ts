import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { getAdminDb, notificationDb } from '@/lib/supabase/db';
import { TransactionStatus, PaymentMethod } from '@/types/wallet';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { isWalletEnabled } from '@/lib/wallet/service';
import { withSignedReceipts } from '@/lib/wallet/receipts';

/**
 * GET /api/admin/wallet-transactions
 * Fetch all wallet transactions with optional status filter
 */
export async function GET(request: NextRequest) {
    try {
        // Validate admin session
        const adminSession = await validateAdminSession();
        if (!adminSession.valid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Feature flag guard
        if (!await isWalletEnabled()) {
            return NextResponse.json(
                { error: 'Wallet feature is currently disabled', code: 'WALLET_DISABLED' },
                { status: 503 }
            );
        }

        // Get query params
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') as TransactionStatus | 'all' | null;
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = (page - 1) * limit;

        const supabase = getAdminDb();

        // Try RPC first
        try {
            const { data, error } = await supabase.rpc('get_admin_wallet_transactions', {
                p_status: status || 'all',
                p_page: page,
                p_limit: limit
            });

            if (!error && data?.success) {
                return NextResponse.json({
                    success: true,
                    // Receipts are private: swap each stored reference for a short-lived signed link
                    transactions: await withSignedReceipts(supabase, data.transactions || []),
                    pagination: data.pagination
                });
            }
        } catch (rpcError) {
            console.warn('RPC fallback to direct query:', rpcError);
        }

        // Fallback to direct Supabase queries
        let query = supabase
            .from('WalletTransaction')
            .select(`
                *,
                User:userId (id, name, email)
            `)
            .order('status', { ascending: true })
            .order('createdAt', { ascending: false })
            .range(offset, offset + limit - 1);

        if (status && status !== 'all') {
            query = query.eq('status', status);
        }

        const { data: transactions, error } = await query;

        if (error) throw error;

        const formattedTransactions = (transactions || []).map((tx: any) => ({
            id: tx.id,
            userId: tx.userId,
            amount: tx.amount,
            paymentMethod: tx.paymentMethod as PaymentMethod,
            transactionId: tx.transactionId,
            status: tx.status as TransactionStatus,
            proofImage: tx.proofImage,
            adminNotes: tx.adminNotes,
            processedAt: tx.processedAt || null,
            processedBy: tx.processedBy,
            createdAt: tx.createdAt,
            updatedAt: tx.updatedAt,
            user: Array.isArray(tx.User) ? tx.User[0] : tx.User,
        }));

        return NextResponse.json({
            success: true,
            transactions: await withSignedReceipts(supabase, formattedTransactions),
        });
    } catch (error) {
        console.error('Error fetching wallet transactions:', error);
        return NextResponse.json(
            { error: 'Failed to fetch transactions' },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/admin/wallet-transactions
 * Approve or reject a wallet transaction.
 *
 * Only through approve_wallet_transaction / reject_wallet_transaction: they lock the row, refuse a
 * deposit that is no longer pending, and change the balance and the status in one transaction. When the
 * call fails the admin sees an error and can try again. There is deliberately no direct-write fallback:
 * it used to read the balance and write the total back, which could credit a deposit twice.
 */
export async function PATCH(request: NextRequest) {
    try {
        // Validate admin session
        const adminSession = await validateAdminSession();
        if (!adminSession.valid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Apply CSRF protection for mutating admin action
        const csrfValidation = await requireCSRFToken(request);
        if (csrfValidation) return csrfValidation;

        const body = await request.json();
        const { transactionId, action, notes } = body;

        if (!transactionId) {
            return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
        }

        if (!action || !['approve', 'reject'].includes(action)) {
            return NextResponse.json({ error: 'Invalid action. Must be "approve" or "reject"' }, { status: 400 });
        }

        const supabase = getAdminDb();
        const processedBy = adminSession.email || 'admin';

        const { data, error } = action === 'approve'
            ? await supabase.rpc('approve_wallet_transaction', {
                p_transaction_id: transactionId,
                p_processed_by: processedBy,
            })
            : await supabase.rpc('reject_wallet_transaction', {
                p_transaction_id: transactionId,
                p_processed_by: processedBy,
                p_reason: notes || null,
            });

        if (error) throw error;

        const result = data as { success?: boolean; error?: string; new_balance?: number } | null;
        if (!result?.success) {
            return NextResponse.json({ error: result?.error || `Failed to ${action}` }, { status: 400 });
        }

        // Tell the player (best effort: the transaction is already processed)
        try {
            const { data: txData } = await supabase
                .from('WalletTransaction')
                .select('userId, amount')
                .eq('id', transactionId)
                .single();

            if (txData) {
                await notificationDb.create(txData.userId, action === 'approve'
                    ? {
                        title: 'Deposit Approved',
                        message: `Your deposit of ${txData.amount} PKR has been approved and added to your wallet.`,
                        type: 'wallet_deposit',
                        link: '/profile/wallet'
                    }
                    : {
                        title: 'Deposit Rejected',
                        message: `Your deposit of ${txData.amount} PKR was rejected. Reason: ${notes || 'Not provided'}`,
                        type: 'wallet_deposit',
                        link: '/profile/wallet'
                    });
            }
        } catch (notifErr) {
            console.error('Failed to send notification:', notifErr);
        }

        return NextResponse.json(action === 'approve'
            ? {
                success: true,
                message: 'Transaction approved successfully',
                status: 'approved',
                newBalance: result.new_balance,
            }
            : {
                success: true,
                message: 'Transaction rejected',
            });
    } catch (error) {
        console.error('Error processing wallet transaction:', error);
        return NextResponse.json(
            { error: 'Failed to process transaction' },
            { status: 500 }
        );
    }
}
