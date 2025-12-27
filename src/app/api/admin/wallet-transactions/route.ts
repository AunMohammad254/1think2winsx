import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { getDb } from '@/lib/supabase/db';
import { TransactionStatus, PaymentMethod } from '@/types/wallet';

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

        // Get query params
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') as TransactionStatus | 'all' | null;
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = (page - 1) * limit;

        const supabase = await getDb();

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
                    transactions: data.transactions || [],
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
            transactions: formattedTransactions,
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
 * Approve or reject a wallet transaction
 */
export async function PATCH(request: NextRequest) {
    try {
        // Validate admin session
        const adminSession = await validateAdminSession();
        if (!adminSession.valid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { transactionId, action, notes } = body;

        if (!transactionId) {
            return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
        }

        if (!action || !['approve', 'reject'].includes(action)) {
            return NextResponse.json({ error: 'Invalid action. Must be "approve" or "reject"' }, { status: 400 });
        }

        const supabase = await getDb();

        // Try RPC first for approval (which needs atomic balance update)
        if (action === 'approve') {
            try {
                const { data, error } = await supabase.rpc('approve_wallet_transaction', {
                    p_transaction_id: transactionId,
                    p_processed_by: adminSession.email || 'admin'
                });

                if (!error && data?.success) {
                    return NextResponse.json({
                        success: true,
                        message: 'Transaction approved successfully',
                        status: 'approved',
                        newBalance: data.new_balance,
                    });
                }

                if (data && !data.success) {
                    return NextResponse.json({ error: data.error || 'Failed to approve' }, { status: 400 });
                }
            } catch (rpcError) {
                console.warn('RPC fallback for approval:', rpcError);
            }
        }

        // Try RPC for rejection
        if (action === 'reject') {
            try {
                const { data, error } = await supabase.rpc('reject_wallet_transaction', {
                    p_transaction_id: transactionId,
                    p_processed_by: adminSession.email || 'admin',
                    p_reason: notes || null
                });

                if (!error && data?.success) {
                    return NextResponse.json({
                        success: true,
                        message: 'Transaction rejected',
                    });
                }

                if (data && !data.success) {
                    return NextResponse.json({ error: data.error || 'Failed to reject' }, { status: 400 });
                }
            } catch (rpcError) {
                console.warn('RPC fallback for rejection:', rpcError);
            }
        }

        // Fallback to direct queries
        const { data: transaction, error: fetchError } = await supabase
            .from('WalletTransaction')
            .select('*, User:userId (id, walletBalance)')
            .eq('id', transactionId)
            .single();

        if (fetchError || !transaction) {
            return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
        }

        if (transaction.status !== 'pending') {
            return NextResponse.json(
                { error: `Transaction is already ${transaction.status}` },
                { status: 400 }
            );
        }

        if (action === 'approve') {
            const user = Array.isArray(transaction.User) ? transaction.User[0] : transaction.User;
            const newBalance = (user?.walletBalance || 0) + transaction.amount;

            // Update user balance
            await supabase
                .from('User')
                .update({
                    walletBalance: newBalance,
                    updatedAt: new Date().toISOString()
                })
                .eq('id', transaction.userId);

            // Update transaction
            const { data: updatedTransaction, error: updateError } = await supabase
                .from('WalletTransaction')
                .update({
                    status: 'approved',
                    processedAt: new Date().toISOString(),
                    processedBy: adminSession.email,
                    updatedAt: new Date().toISOString(),
                })
                .eq('id', transactionId)
                .select()
                .single();

            if (updateError) throw updateError;

            return NextResponse.json({
                success: true,
                message: 'Transaction approved successfully',
                transaction: updatedTransaction,
                newBalance,
            });
        } else {
            // Reject transaction
            const { data: updatedTransaction, error: updateError } = await supabase
                .from('WalletTransaction')
                .update({
                    status: 'rejected',
                    adminNotes: notes || null,
                    processedAt: new Date().toISOString(),
                    processedBy: adminSession.email,
                    updatedAt: new Date().toISOString(),
                })
                .eq('id', transactionId)
                .select()
                .single();

            if (updateError) throw updateError;

            return NextResponse.json({
                success: true,
                message: 'Transaction rejected',
                transaction: updatedTransaction,
            });
        }
    } catch (error) {
        console.error('Error processing wallet transaction:', error);
        return NextResponse.json(
            { error: 'Failed to process transaction' },
            { status: 500 }
        );
    }
}
