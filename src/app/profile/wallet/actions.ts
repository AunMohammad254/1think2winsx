'use server';

import { createClient } from '@/lib/supabase/server';
import { MIN_DEPOSIT_AMOUNT, DepositRequestResponse, WalletBalanceResponse, TransactionHistoryResponse, PaymentMethod } from '@/types/wallet';
import { revalidatePath } from 'next/cache';
import { rateLimiters } from '@/lib/rate-limiter';

/**
 * Submit a new deposit request
 */
export async function submitDepositRequest(formData: FormData): Promise<DepositRequestResponse> {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return { success: false, error: 'You must be logged in to submit a deposit request' };
        }

        // Apply rate limiting (Strategy 2)
        // Pass a mock request object since we only need the userId for the key generator
        const rateLimitResult = await rateLimiters.deposit.checkLimit(
            { headers: { get: () => null } } as any, 
            user.id, 
            'deposit'
        );
        
        if (!rateLimitResult.success) {
            return { success: false, error: 'Too many deposit requests. Please try again later.' };
        }

        // Parse form data
        const amountStr = formData.get('amount') as string;
        const paymentMethod = formData.get('paymentMethod') as PaymentMethod;
        const transactionId = formData.get('transactionId') as string;
        const proofImage = formData.get('proofImage') as File | null;

        // Validate amount
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount < MIN_DEPOSIT_AMOUNT) {
            return { success: false, error: `Minimum deposit amount is ${MIN_DEPOSIT_AMOUNT} PKR` };
        }

        // Validate payment method
        const validMethods: PaymentMethod[] = ['Easypaisa', 'Jazzcash', 'Bank'];
        if (!validMethods.includes(paymentMethod)) {
            return { success: false, error: 'Invalid payment method' };
        }

        // Validate transaction ID
        if (!transactionId || transactionId.trim().length === 0) {
            return { success: false, error: 'Transaction ID is required' };
        }

        // Check for existing pending deposits (Strategy 1)
        const MAX_PENDING_DEPOSITS = 2;
        const { count, error: countError } = await supabase
            .from('WalletTransaction')
            .select('*', { count: 'exact', head: true })
            .eq('userId', user.id)
            .eq('status', 'pending')
            .gt('amount', 0); // Deposits are positive amounts

        if (countError) {
            console.error('Error checking pending transactions:', countError);
            return { success: false, error: 'Failed to validate request. Please try again.' };
        }

        if (count !== null && count >= MAX_PENDING_DEPOSITS) {
            return { 
                success: false, 
                error: `You already have ${count} pending deposit requests. Please wait for them to be processed before submitting a new one.` 
            };
        }

        // Fraud check: duplicate amount+method within 1 hour (Strategy 3)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count: dupeCount, error: dupeError } = await supabase
            .from('WalletTransaction')
            .select('*', { count: 'exact', head: true })
            .eq('userId', user.id)
            .eq('amount', amount)
            .eq('paymentMethod', paymentMethod)
            .eq('status', 'pending')
            .gte('createdAt', oneHourAgo);

        if (!dupeError && dupeCount !== null && dupeCount > 0) {
            return {
                success: false,
                error: 'A pending deposit for the same amount and payment method was submitted recently. Please wait before submitting again.'
            };
        }

        // Require proof image
        if (!proofImage || proofImage.size === 0) {
            return { success: false, error: 'Proof of payment screenshot is required. Please upload your transaction screenshot.' };
        }

        // Handle image upload if present
        let proofImageUrl = null;
        if (proofImage && proofImage.size > 0) {
            if (proofImage.size > 5 * 1024 * 1024) {
                return { success: false, error: 'Receipt image must be less than 5MB' };
            }
            
            const ext = proofImage.name.split('.').pop() || 'png';
            const fileName = `${user.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
            
            const { data: uploadData, error: uploadError } = await supabase
                .storage
                .from('receipts')
                .upload(fileName, proofImage);
                
            if (uploadError) {
                console.error('Error uploading receipt:', uploadError);
                return { success: false, error: 'Failed to upload receipt image. Please try again.' };
            }
            
            const { data: { publicUrl } } = supabase
                .storage
                .from('receipts')
                .getPublicUrl(fileName);
                
            proofImageUrl = publicUrl;
        }

        // Call Supabase RPC function
        const { data, error } = await supabase.rpc('submit_deposit_request', {
            p_amount: amount,
            p_payment_method: paymentMethod,
            p_transaction_id: transactionId.trim(),
            p_proof_image: proofImageUrl
        });

        if (error) {
            console.error('Supabase RPC Error:', error);
            // Handle specific errors returned by the function
            // The function returns JSON, but the RPC client might wrap it or return Postgres error
            return { success: false, error: error.message || 'Failed to submit request' };
        }

        // The RPC returns { success: boolean, error?: string, id?: string }
        // We need to cast it or check properties
        const result = data as any;

        if (!result.success) {
            return { success: false, error: result.error || 'Submission failed' };
        }

        // If successful, fetch the created transaction to return it
        const { data: transaction, error: fetchError } = await supabase
            .from('WalletTransaction')
            .select('*')
            .eq('id', result.id)
            .single();

        if (fetchError || !transaction) {
            // It succeeded but we couldn't fetch it back immediately (rare)
            revalidatePath('/profile/wallet');
            return { success: true, message: 'Deposit request submitted successfully' };
        }

        // Revalidate the wallet page
        revalidatePath('/profile/wallet');

        return {
            success: true,
            message: 'Deposit request submitted successfully',
            transaction: {
                ...transaction,
                createdAt: transaction.createdAt, // Supabase returns ISO string usually
                updatedAt: transaction.updatedAt,
                processedAt: transaction.processedAt,
                paymentMethod: transaction.paymentMethod as PaymentMethod,
                status: transaction.status as 'pending' | 'approved' | 'rejected',
            },
        };
    } catch (error) {
        console.error('Error submitting deposit request:', error);
        return { success: false, error: 'Failed to submit deposit request. Please try again.' };
    }
}

/**
 * Get current user's wallet balance
 */
export async function getWalletBalance(): Promise<WalletBalanceResponse> {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return { success: false, error: 'You must be logged in to view wallet balance' };
        }

        // Query by email since Prisma User uses CUID while Supabase uses UUID
        const { data, error } = await supabase
            .from('User')
            .select('walletBalance')
            .eq('email', user.email)
            .single();

        if (error) {
            console.error('Error fetching balance from Supabase:', error);
            // If user not found, return 0 balance (user may not be synced yet)
            if (error.code === 'PGRST116') {
                return { success: true, balance: 0 };
            }
            return { success: false, error: 'Failed to fetch wallet balance' };
        }

        return {
            success: true,
            balance: data?.walletBalance || 0,
        };
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        return { success: false, error: 'Failed to fetch wallet balance' };
    }
}

/**
 * Get current user's transaction history
 */
export async function getTransactionHistory(): Promise<TransactionHistoryResponse> {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return { success: false, error: 'You must be logged in to view transaction history' };
        }

        // First get the user ID from the User table by email
        const { data: userData, error: userError } = await supabase
            .from('User')
            .select('id')
            .eq('email', user.email)
            .single();

        if (userError || !userData) {
            console.error('Error finding user:', userError);
            // If user not found, return empty transactions
            return { success: true, transactions: [] };
        }

        const { data: transactions, error } = await supabase
            .from('WalletTransaction')
            .select('*')
            .eq('userId', userData.id)
            .order('createdAt', { ascending: false });

        if (error) {
            console.error('Error fetching transactions from Supabase:', error);
            return { success: false, error: 'Failed to fetch transaction history' };
        }

        return {
            success: true,
            transactions: (transactions || []).map((tx) => ({
                ...tx,
                createdAt: tx.createdAt,
                updatedAt: tx.updatedAt,
                processedAt: tx.processedAt,
                paymentMethod: tx.paymentMethod as PaymentMethod,
                status: tx.status as 'pending' | 'approved' | 'rejected',
            })),
        };
    } catch (error) {
        console.error('Error fetching transaction history:', error);
        return { success: false, error: 'Failed to fetch transaction history' };
    }
}
