'use server';

import { getAdminDb } from '@/lib/supabase/db';
import { requireAdminSession } from '@/lib/admin-session';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

/**
 * Resolve the Supabase Auth user id for a public.User row.
 * The signup trigger creates public.User with the auth id, so try that first; fall back to an
 * email search (paged — listUsers() alone only returns the first 50 users) for legacy rows.
 */
async function findAuthUserId(supabase: ReturnType<typeof getAdminDb>, userId: string, email: string): Promise<string | null> {
    const { data } = await supabase.auth.admin.getUserById(userId);
    if (data?.user) return data.user.id;

    const target = email.toLowerCase();
    for (let page = 1; page <= 100; page++) {
        const { data: list, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const match = list.users.find((u) => u.email?.toLowerCase() === target);
        if (match) return match.id;
        if (list.users.length < 1000) break;
    }
    return null;
}

export async function lookupUserAction(query: string) {
    try {
        await requireAdminSession();
        const supabase = getAdminDb();
        
        // Check if query is email or ID
        const isEmail = query.includes('@');
        
        let dbQuery = supabase.from('User').select('*');
        if (isEmail) {
            dbQuery = dbQuery.eq('email', query.trim());
        } else {
            dbQuery = dbQuery.eq('id', query.trim());
        }
        
        const { data: userRow, error } = await dbQuery.maybeSingle();

        if (error || !userRow) {
            return { success: false, error: 'User not found' };
        }
        // Never send the password hash to the browser
        const { password: _password, ...user } = userRow;
        
        // Get recent redemptions
        const { data: redemptions } = await supabase
            .from('PrizeRedemption')
            .select('*, Prize(name)')
            .eq('userId', user.id)
            .order('createdAt', { ascending: false })
            .limit(5);
            
        // Get recent quiz attempts
        const { data: attempts } = await supabase
            .from('QuizAttempt')
            .select('*, Quiz(title)')
            .eq('userId', user.id)
            .order('createdAt', { ascending: false })
            .limit(5);
            
        return { 
            success: true, 
            user,
            redemptions: redemptions || [],
            attempts: attempts || []
        };
    } catch (e: any) {
        return { success: false, error: e.message || 'An error occurred' };
    }
}

export async function adjustUserBalanceAction(userId: string, type: 'points' | 'wallet', amount: number, reason: string) {
    try {
        const adminEmail = await requireAdminSession();
        const supabase = getAdminDb();
        
        if (type === 'points') {
            const { error } = await supabase.rpc('increment_user_points', { p_user_id: userId, p_delta: amount });
            if (error) return { success: false, error: error.message };
        } else {
            const { error } = await supabase.rpc('increment_user_wallet', { p_user_id: userId, p_delta: amount });
            if (error) return { success: false, error: error.message };
        }
        
        // Try to log securely (best effort)
        try {
            await supabase.from('SecurityEvent').insert({
                type: 'ADMIN_BALANCE_ADJUSTMENT',
                userId,
                details: { type, amount, reason, adminEmail },
                environment: process.env.NODE_ENV,
                severity: 'MEDIUM'
            });
        } catch (e) {
            console.error('Failed to log security event:', e);
        }
        
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'An error occurred' };
    }
}

export async function updateUserProfileAction(userId: string, data: { name?: string; phone?: string; }) {
    try {
        const adminEmail = await requireAdminSession();
        const { userDb } = await import('@/lib/supabase/db');
        const supabase = getAdminDb();
        
        await userDb.update(userId, data);
        
        // Log action (best effort — the update above already succeeded)
        const { error: logError } = await supabase.from('SecurityEvent').insert({
            type: 'ADMIN_PROFILE_UPDATE',
            userId,
            details: { data, adminEmail },
            severity: 'LOW'
        });
        if (logError) console.error('Failed to log security event:', logError);
        
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to update user profile' };
    }
}

export async function updateUserPasswordAction(userId: string, newPassword: string) {
    try {
        const adminEmail = await requireAdminSession();
        const { userDb } = await import('@/lib/supabase/db');
        const supabase = getAdminDb();
        
        // 1. First get user email to update auth
        const user = await userDb.findById(userId);
        if (!user || !user.email) return { success: false, error: 'User not found or has no email' };
        
        // 2. Hash the password for the public.User table
        const bcrypt = await import('bcryptjs');
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        
        // 3. Update public.User table
        await userDb.update(userId, { password: hashedPassword });
        
        // 4. Update Supabase Auth if the user has an auth record
        const authUserId = await findAuthUserId(supabase, userId, user.email);

        if (authUserId) {
            const { error: authError } = await supabase.auth.admin.updateUserById(authUserId, {
                password: newPassword
            });
            if (authError) throw authError;
        }

        // 5. Log action (best effort — the password is already changed)
        const { error: logError } = await supabase.from('SecurityEvent').insert({
            type: 'ADMIN_PASSWORD_RESET',
            userId,
            details: { adminEmail },
            severity: 'HIGH'
        });
        if (logError) console.error('Failed to log security event:', logError);
        
        return { success: true };
    } catch (e: any) {
        console.error('Password reset error:', e);
        return { success: false, error: e.message || 'Failed to reset password' };
    }
}

export async function suspendUserAction(userId: string, isSuspended: boolean) {
    try {
        const adminEmail = await requireAdminSession();
        const { userDb } = await import('@/lib/supabase/db');
        const supabase = getAdminDb();
        
        const user = await userDb.findById(userId);
        if (!user || !user.email) return { success: false, error: 'User not found' };
        
        const authUserId = await findAuthUserId(supabase, userId, user.email);
        if (!authUserId) return { success: false, error: 'No login account found for this user' };

        const { error: authError } = await supabase.auth.admin.updateUserById(authUserId, {
            ban_duration: isSuspended ? '87600h' : 'none'
        });
        if (authError) throw authError;
        
        await supabase.from('SecurityEvent').insert({
            type: isSuspended ? 'ADMIN_USER_SUSPENDED' : 'ADMIN_USER_UNSUSPENDED',
            userId,
            details: { adminEmail },
            severity: 'HIGH'
        });
        
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to update suspension status' };
    }
}

export async function forceVerifyEmailAction(userId: string) {
    try {
        const adminEmail = await requireAdminSession();
        const { userDb } = await import('@/lib/supabase/db');
        const supabase = getAdminDb();
        
        const user = await userDb.findById(userId);
        if (!user || !user.email) return { success: false, error: 'User not found' };
        
        const authUserId = await findAuthUserId(supabase, userId, user.email);
        if (!authUserId) return { success: false, error: 'No login account found for this user' };

        const { error: authError } = await supabase.auth.admin.updateUserById(authUserId, {
            email_confirm: true
        });
        if (authError) throw authError;
        
        await supabase.from('SecurityEvent').insert({
            type: 'ADMIN_FORCE_EMAIL_VERIFY',
            userId,
            details: { adminEmail },
            severity: 'MEDIUM'
        });
        
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to verify email' };
    }
}

export async function resendVerificationEmailAction(userId: string) {
    try {
        const adminEmail = await requireAdminSession();
        const { userDb } = await import('@/lib/supabase/db');
        const supabase = getAdminDb();
        
        const user = await userDb.findById(userId);
        if (!user || !user.email) return { success: false, error: 'User not found' };
        
        // 1. Generate the raw verification link from Supabase (bypassing Supabase's email service).
        // A 'signup' link needs the user's password, which admins don't have; opening a magic link
        // confirms the email address as well.
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: 'magiclink',
            email: user.email,
            options: {
                redirectTo: SITE_URL
            }
        });
        
        if (linkError) throw linkError;
        
        const verificationUrl = linkData.properties.action_link;
        
        // 2. Send it using our native Nodemailer + Brevo setup
        const { sendEmail, generateBeautifulEmailTemplate } = await import('@/lib/email');
        
        const htmlBody = generateBeautifulEmailTemplate(
            "Verify Your Email",
            `<p>Welcome to 1Think 2Win! Please verify your email address to continue setting up your account.</p>
             <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" style="display: inline-block; background: #eab308; color: #000000; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">Verify My Email Address</a>
             </div>
             <p style="font-size: 12px; color: #71717a;">If the button doesn't work, copy and paste this link into your browser: <br>${verificationUrl}</p>`
        );
        
        const emailResult = await sendEmail({
            to: user.email,
            subject: "Action Required: Verify Your 1Think 2Win Account",
            html: htmlBody
        });
        
        if (!emailResult.success) throw new Error(emailResult.error);
        
        await supabase.from('SecurityEvent').insert({
            type: 'ADMIN_RESEND_VERIFICATION_EMAIL',
            userId,
            details: { adminEmail, viaBrevo: true },
            severity: 'LOW'
        });
        
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to resend verification email' };
    }
}

export async function generateImpersonationLinkAction(userId: string) {
    try {
        const adminEmail = await requireAdminSession();
        const { userDb } = await import('@/lib/supabase/db');
        const supabase = getAdminDb();
        
        const user = await userDb.findById(userId);
        if (!user || !user.email) return { success: false, error: 'User not found' };
        
        const { data, error } = await supabase.auth.admin.generateLink({
            type: 'magiclink',
            email: user.email,
            options: {
                redirectTo: SITE_URL
            }
        });
        
        if (error) throw error;
        
        await supabase.from('SecurityEvent').insert({
            type: 'ADMIN_IMPERSONATION_LINK_GENERATED',
            userId,
            details: { adminEmail },
            severity: 'CRITICAL'
        });
        
        return { success: true, link: data.properties.action_link };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to generate link' };
    }
}

export async function sendNotificationAction(userId: string, title: string, message: string, sendAsEmail: boolean = false) {
    try {
        const adminEmail = await requireAdminSession();
        const { notificationDb, userDb } = await import('@/lib/supabase/db');
        const supabase = getAdminDb();
        
        await notificationDb.create(userId, {
            title,
            message,
            type: 'admin_message',
            link: '/profile'
        });
        
        let emailSent = false;
        if (sendAsEmail) {
            const user = await userDb.findById(userId);
            if (user && user.email) {
                const { sendEmail, generateBeautifulEmailTemplate } = await import('@/lib/email');
                const htmlBody = generateBeautifulEmailTemplate(
                    title,
                    `<p>${message.replace(/\n/g, '<br>')}</p><br><p>Log in to your dashboard to see more details.</p>`
                );
                
                const emailResult = await sendEmail({
                    to: user.email,
                    subject: title,
                    html: htmlBody,
                    text: message
                });
                
                if (emailResult.success) {
                    emailSent = true;
                }
            }
        }
        
        await supabase.from('SecurityEvent').insert({
            type: 'ADMIN_NOTIFICATION_SENT',
            userId,
            details: { adminEmail, title, emailSent },
            severity: 'LOW'
        });
        
        return { success: true, emailSent };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to send notification' };
    }
}

export async function refundQuizAttemptAction(attemptId: string) {
    try {
        const adminEmail = await requireAdminSession();
        const supabase = getAdminDb();
        
        const { data: attempt, error: fetchError } = await supabase
            .from('QuizAttempt')
            .select('userId, quizId, Quiz(accessPrice)')
            .eq('id', attemptId)
            .single();
            
        if (fetchError || !attempt) return { success: false, error: 'Attempt not found' };
        
        // Embedded many-to-one relation: PostgREST returns an object, the generated types say array
        const quiz = attempt.Quiz as unknown as { accessPrice: number | null } | null;
        const price = quiz?.accessPrice || 0;

        // Delete first: if it fails, nothing is refunded (no double refund on retry)
        const { error: delError } = await supabase.from('QuizAttempt').delete().eq('id', attemptId);
        if (delError) throw delError;

        // Refund — access is charged from walletBalance (PKR) by pay_quiz_access, not points
        if (price > 0) {
            const { error: refundError } = await supabase.rpc('increment_user_wallet', { p_user_id: attempt.userId, p_delta: price });
            if (refundError) throw refundError;
        }
        
        await supabase.from('SecurityEvent').insert({
            type: 'ADMIN_QUIZ_REFUND',
            userId: attempt.userId,
            details: { adminEmail, attemptId, priceRefunded: price },
            severity: 'MEDIUM'
        });
        
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to refund attempt' };
    }
}

export async function getUserSecurityLogsAction(userId: string) {
    try {
        await requireAdminSession();
        const supabase = getAdminDb();
        
        const { data, error } = await supabase
            .from('SecurityEvent')
            .select('*')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })
            .limit(10);
            
        if (error) throw error;
        
        return { success: true, logs: data };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to fetch logs' };
    }
}

export async function addAdminNoteAction(userId: string, note: string, tags: string[]) {
    try {
        const adminEmail = await requireAdminSession();
        const supabase = getAdminDb();
        
        await supabase.from('SecurityEvent').insert({
            type: 'ADMIN_NOTE',
            userId,
            details: { note, tags, adminEmail },
            severity: 'LOW'
        });
        
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to add note' };
    }
}

export async function getAdminNotesAction(userId: string) {
    try {
        await requireAdminSession();
        const supabase = getAdminDb();
        
        const { data, error } = await supabase
            .from('SecurityEvent')
            .select('*')
            .eq('userId', userId)
            .eq('type', 'ADMIN_NOTE')
            .order('createdAt', { ascending: false });
            
        if (error) throw error;
        
        return { success: true, notes: data };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to fetch notes' };
    }
}

export async function generateGDPRExportAction(userId: string) {
    try {
        await requireAdminSession();
        const supabase = getAdminDb();
        const { userDb } = await import('@/lib/supabase/db');
        
        // 1. Get User Profile
        const user = await userDb.findById(userId);
        if (!user) return { success: false, error: 'User not found' };
        
        // 2. Get Quizzes
        const { data: attempts } = await supabase.from('QuizAttempt').select('*, Quiz(title)').eq('userId', userId);
        
        // 3. Get Redemptions
        const { data: redemptions } = await supabase.from('PrizeRedemption').select('*, Prize(name)').eq('userId', userId);
        
        // 4. Get Quiz Winners
        const { data: winners } = await supabase.from('QuizWinner').select('*').eq('userId', userId);
        
        // 5. Build export JSON
        const exportData = {
            generatedAt: new Date().toISOString(),
            profile: user,
            activity: {
                quizAttempts: attempts || [],
                prizeClaims: redemptions || [],
                luckyWins: winners || []
            }
        };
        
        // Log action
        const adminEmail = await requireAdminSession();
        await supabase.from('SecurityEvent').insert({
            type: 'ADMIN_GDPR_EXPORT_DOWNLOADED',
            userId,
            details: { adminEmail },
            severity: 'MEDIUM'
        });
        
        return { success: true, data: exportData };
    } catch (e: any) {
        return { success: false, error: e.message || 'Failed to generate export' };
    }
}
