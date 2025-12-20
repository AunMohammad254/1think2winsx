import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import prisma from '@/lib/prisma';
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

        // Get status filter from query params
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') as TransactionStatus | 'all' | null;

        // Build where clause
        const whereClause = status && status !== 'all' ? { status } : {};

        // Fetch transactions with user info
        const transactions = await prisma.walletTransaction.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
            orderBy: [
                { status: 'asc' }, // pending first
                { createdAt: 'desc' },
            ],
        });

        // Format response
        const formattedTransactions = transactions.map((tx) => ({
            id: tx.id,
            userId: tx.userId,
            amount: tx.amount,
            paymentMethod: tx.paymentMethod as PaymentMethod,
            transactionId: tx.transactionId,
            status: tx.status as TransactionStatus,
            proofImage: tx.proofImage,
            adminNotes: tx.adminNotes,
            processedAt: tx.processedAt?.toISOString() || null,
            processedBy: tx.processedBy,
            createdAt: tx.createdAt.toISOString(),
            updatedAt: tx.updatedAt.toISOString(),
            user: tx.user,
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

        // Get the transaction
        const transaction = await prisma.walletTransaction.findUnique({
            where: { id: transactionId },
            include: { user: true },
        });

        if (!transaction) {
            return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
        }

        if (transaction.status !== 'pending') {
            return NextResponse.json(
                { error: `Transaction is already ${transaction.status}` },
                { status: 400 }
            );
        }

        if (action === 'approve') {
            // Use a transaction to atomically update both records
            const result = await prisma.$transaction(async (tx) => {
                // Update transaction status
                const updatedTransaction = await tx.walletTransaction.update({
                    where: { id: transactionId },
                    data: {
                        status: 'approved',
                        processedAt: new Date(),
                        processedBy: adminSession.email,
                    },
                });

                // Update user's wallet balance
                const updatedUser = await tx.user.update({
                    where: { id: transaction.userId },
                    data: {
                        walletBalance: {
                            increment: transaction.amount,
                        },
                    },
                });

                return { updatedTransaction, updatedUser };
            });

            return NextResponse.json({
                success: true,
                message: 'Transaction approved successfully',
                transaction: {
                    ...result.updatedTransaction,
                    createdAt: result.updatedTransaction.createdAt.toISOString(),
                    updatedAt: result.updatedTransaction.updatedAt.toISOString(),
                    processedAt: result.updatedTransaction.processedAt?.toISOString(),
                },
                newBalance: result.updatedUser.walletBalance,
            });
        } else {
            // Reject transaction
            const updatedTransaction = await prisma.walletTransaction.update({
                where: { id: transactionId },
                data: {
                    status: 'rejected',
                    adminNotes: notes || null,
                    processedAt: new Date(),
                    processedBy: adminSession.email,
                },
            });

            return NextResponse.json({
                success: true,
                message: 'Transaction rejected',
                transaction: {
                    ...updatedTransaction,
                    createdAt: updatedTransaction.createdAt.toISOString(),
                    updatedAt: updatedTransaction.updatedAt.toISOString(),
                    processedAt: updatedTransaction.processedAt?.toISOString(),
                },
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
