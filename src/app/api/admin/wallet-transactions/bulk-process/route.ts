import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { getDb, notificationDb } from '@/lib/supabase/db';
import { isWalletEnabled } from '@/lib/wallet/service';

export async function POST(request: NextRequest) {
    try {
        const adminSession = await validateAdminSession();
        if (!adminSession.valid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!await isWalletEnabled()) {
            return NextResponse.json(
                { error: 'Wallet feature is currently disabled', code: 'WALLET_DISABLED' },
                { status: 503 }
            );
        }

        const body = await request.json();
        const { transactionIds, action, notes } = body;

        if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
            return NextResponse.json({ error: 'Transaction IDs array is required' }, { status: 400 });
        }

        if (!action || !['approve', 'reject'].includes(action)) {
            return NextResponse.json({ error: 'Invalid action. Must be "approve" or "reject"' }, { status: 400 });
        }

        const supabase = await getDb();
        const results = {
            success: 0,
            failed: 0,
            errors: [] as string[]
        };

        for (const transactionId of transactionIds) {
            try {
                // Fetch transaction
                const { data: transaction, error: fetchError } = await supabase
                    .from('WalletTransaction')
                    .select('*, User:userId (id, walletBalance)')
                    .eq('id', transactionId)
                    .single();

                if (fetchError || !transaction) {
                    results.failed++;
                    results.errors.push(`Transaction ${transactionId} not found`);
                    continue;
                }

                if (transaction.status !== 'pending') {
                    results.failed++;
                    results.errors.push(`Transaction ${transactionId} is already ${transaction.status}`);
                    continue;
                }

                if (action === 'approve') {
                    const user = Array.isArray(transaction.User) ? transaction.User[0] : transaction.User;
                    const newBalance = (user?.walletBalance || 0) + transaction.amount;

                    await supabase
                        .from('User')
                        .update({ walletBalance: newBalance, updatedAt: new Date().toISOString() })
                        .eq('id', transaction.userId);

                    await supabase
                        .from('WalletTransaction')
                        .update({
                            status: 'approved',
                            processedAt: new Date().toISOString(),
                            processedBy: adminSession.email,
                            updatedAt: new Date().toISOString(),
                        })
                        .eq('id', transactionId);

                    try {
                        await notificationDb.create(transaction.userId, {
                            title: 'Deposit Approved',
                            message: `Your deposit of ${transaction.amount} PKR has been approved and added to your wallet.`,
                            type: 'wallet_deposit',
                            link: '/profile/wallet'
                        });
                    } catch (e) {
                        console.error('Notification error:', e);
                    }
                    
                    results.success++;
                } else {
                    await supabase
                        .from('WalletTransaction')
                        .update({
                            status: 'rejected',
                            adminNotes: notes || null,
                            processedAt: new Date().toISOString(),
                            processedBy: adminSession.email,
                            updatedAt: new Date().toISOString(),
                        })
                        .eq('id', transactionId);
                        
                    try {
                        await notificationDb.create(transaction.userId, {
                            title: 'Deposit Rejected',
                            message: `Your deposit of ${transaction.amount} PKR was rejected. Reason: ${notes || 'Not provided'}`,
                            type: 'wallet_deposit',
                            link: '/profile/wallet'
                        });
                    } catch (e) {
                        console.error('Notification error:', e);
                    }

                    results.success++;
                }
            } catch (err) {
                results.failed++;
                results.errors.push(`Failed to process ${transactionId}: ${err instanceof Error ? err.message : String(err)}`);
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
