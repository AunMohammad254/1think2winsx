'use client';

import { useState } from 'react';
import { Search, User, CreditCard, History, Trophy, AlertCircle, Plus, Minus, ArrowRight, Wallet, Loader2, CheckCircle2, ArrowLeft, Key, Save, Edit3, Ban, Mail, Link as LinkIcon, ShieldAlert, RefreshCcw, Bell, Download, FileText, Tag, Send } from 'lucide-react';
import { lookupUserAction, adjustUserBalanceAction, updateUserProfileAction, updateUserPasswordAction, suspendUserAction, forceVerifyEmailAction, resendVerificationEmailAction, generateImpersonationLinkAction, sendNotificationAction, refundQuizAttemptAction, getUserSecurityLogsAction, addAdminNoteAction, getAdminNotesAction, generateGDPRExportAction } from '@/actions/support-actions';
import Link from 'next/link';

export default function UserSupportPage() {
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    
    const [userData, setUserData] = useState<any>(null);
    const [redemptions, setRedemptions] = useState<any[]>([]);
    const [attempts, setAttempts] = useState<any[]>([]);
    
    const [adjusting, setAdjusting] = useState(false);
    const [adjustAmount, setAdjustAmount] = useState('');
    const [adjustReason, setAdjustReason] = useState('');
    const [adjustType, setAdjustType] = useState<'points' | 'wallet'>('points');
    
    // Edit state
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editPhone, setEditPhone] = useState('');
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    
    const [newPassword, setNewPassword] = useState('');
    const [isSavingPassword, setIsSavingPassword] = useState(false);
    
    // New features state
    const [securityLogs, setSecurityLogs] = useState<any[]>([]);
    const [notifTitle, setNotifTitle] = useState('');
    const [notifMessage, setNotifMessage] = useState('');
    const [sendAsEmail, setSendAsEmail] = useState(false);
    const [isSendingNotif, setIsSendingNotif] = useState(false);
    const [isSuspending, setIsSuspending] = useState(false);
    const [isResendingVerify, setIsResendingVerify] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [isImpersonating, setIsImpersonating] = useState(false);
    const [refundingId, setRefundingId] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    
    // Notes state
    const [adminNotes, setAdminNotes] = useState<any[]>([]);
    const [newNote, setNewNote] = useState('');
    const [newTag, setNewTag] = useState('');
    const [isSavingNote, setIsSavingNote] = useState(false);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        
        setIsLoading(true);
        setError(null);
        setSuccessMsg(null);
        setUserData(null);
        
        const result = await lookupUserAction(query);
        
        if (result.success && result.user) {
            setUserData(result.user);
            setRedemptions(result.redemptions || []);
            setAttempts(result.attempts || []);
            setEditName(result.user.name || '');
            setEditPhone(result.user.phone || '');
            setIsEditing(false);
            setNewPassword('');
            
            const logsResult = await getUserSecurityLogsAction(result.user.id);
            if (logsResult.success) setSecurityLogs(logsResult.logs || []);
            
            const notesResult = await getAdminNotesAction(result.user.id);
            if (notesResult.success) setAdminNotes(notesResult.notes || []);
        } else {
            setError(result.error || 'User not found');
        }
        setIsLoading(false);
    };

    const handleAdjust = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userData || !adjustAmount || !adjustReason) return;
        
        const amountNum = parseInt(adjustAmount, 10);
        if (isNaN(amountNum) || amountNum === 0) {
            setError('Please enter a valid non-zero amount');
            return;
        }
        
        setAdjusting(true);
        setError(null);
        setSuccessMsg(null);
        
        const result = await adjustUserBalanceAction(userData.id, adjustType, amountNum, adjustReason);
        
        if (result.success) {
            setSuccessMsg(`Successfully adjusted ${adjustType} by ${amountNum}.`);
            setAdjustAmount('');
            setAdjustReason('');
            // Refresh user data
            const refresh = await lookupUserAction(userData.id);
            if (refresh.success) setUserData(refresh.user);
        } else {
            setError(result.error || 'Failed to adjust balance');
        }
        
        setAdjusting(false);
    };

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userData) return;
        
        setIsSavingProfile(true);
        setError(null);
        setSuccessMsg(null);
        
        const result = await updateUserProfileAction(userData.id, { name: editName, phone: editPhone });
        
        if (result.success) {
            setSuccessMsg('Profile updated successfully.');
            setUserData({ ...userData, name: editName, phone: editPhone });
            setIsEditing(false);
        } else {
            setError(result.error || 'Failed to update profile');
        }
        setIsSavingProfile(false);
    };

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userData || !newPassword || newPassword.length < 8) {
            setError('Password must be at least 8 characters long');
            return;
        }
        
        setIsSavingPassword(true);
        setError(null);
        setSuccessMsg(null);
        
        const result = await updateUserPasswordAction(userData.id, newPassword);
        
        if (result.success) {
            setSuccessMsg('Password changed successfully.');
            setNewPassword('');
        } else {
            setError(result.error || 'Failed to change password');
        }
        setIsSavingPassword(false);
    };

    const handleSuspend = async () => {
        if (!userData || !window.confirm('Are you sure you want to suspend this user?')) return;
        setIsSuspending(true);
        const result = await suspendUserAction(userData.id, true);
        if (result.success) setSuccessMsg('User suspended successfully.');
        else setError(result.error);
        setIsSuspending(false);
    };

    const handleResendVerification = async () => {
        if (!userData) return;
        setIsResendingVerify(true);
        const result = await resendVerificationEmailAction(userData.id);
        if (result.success) setSuccessMsg('Verification email sent to the user.');
        else setError(result.error);
        setIsResendingVerify(false);
    };

    const handleVerifyEmail = async () => {
        if (!userData || !window.confirm('WARNING: Force verifying skips actual email validation. Only use this if the user completely cannot receive emails. Continue?')) return;
        setIsVerifying(true);
        const result = await forceVerifyEmailAction(userData.id);
        if (result.success) setSuccessMsg('Email forcefully verified (Backup).');
        else setError(result.error);
        setIsVerifying(false);
    };

    const handleImpersonate = async () => {
        if (!userData) return;
        setIsImpersonating(true);
        const result = await generateImpersonationLinkAction(userData.id);
        if (result.success) {
            setSuccessMsg('Impersonation link generated! Check below.');
            // We can show it or just alert it
            prompt('Copy this magic link and open it in an Incognito window:', result.link);
        } else setError(result.error);
        setIsImpersonating(false);
    };

    const handleSendNotification = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userData || !notifTitle || !notifMessage) return;
        setIsSendingNotif(true);
        const result = await sendNotificationAction(userData.id, notifTitle, notifMessage, sendAsEmail);
        if (result.success) {
            setSuccessMsg(result.emailSent ? 'Notification sent directly to user dashboard and via Email!' : 'Notification sent directly to user dashboard.');
            setNotifTitle('');
            setNotifMessage('');
            setSendAsEmail(false);
        } else setError(result.error);
        setIsSendingNotif(false);
    };

    const handleRefund = async (attemptId: string) => {
        if (!window.confirm('Are you sure you want to refund this attempt?')) return;
        setRefundingId(attemptId);
        const result = await refundQuizAttemptAction(attemptId);
        if (result.success) {
            setSuccessMsg('Quiz attempt refunded and deleted.');
            setAttempts(attempts.filter(a => a.id !== attemptId));
        } else setError(result.error);
        setRefundingId(null);
    };

    const handleAddNote = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userData || !newNote) return;
        setIsSavingNote(true);
        const tags = newTag ? newTag.split(',').map(t => t.trim()).filter(Boolean) : [];
        const result = await addAdminNoteAction(userData.id, newNote, tags);
        if (result.success) {
            setSuccessMsg('Admin note added successfully.');
            setNewNote('');
            setNewTag('');
            const notesResult = await getAdminNotesAction(userData.id);
            if (notesResult.success) setAdminNotes(notesResult.notes || []);
        } else setError(result.error);
        setIsSavingNote(false);
    };

    const handleExportGDPR = async () => {
        if (!userData) return;
        setIsExporting(true);
        const result = await generateGDPRExportAction(userData.id);
        if (result.success && result.data) {
            const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `user_export_${userData.id}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setSuccessMsg('GDPR Data Exported successfully.');
        } else setError(result.error);
        setIsExporting(false);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-4 md:p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center space-x-4">
                        <div className="p-3 bg-purple-500/20 rounded-xl">
                            <User className="w-8 h-8 text-purple-400" />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-bold text-white">User Support</h1>
                            <p className="text-gray-400 text-sm md:text-base">Look up users by Email or User ID to resolve issues.</p>
                        </div>
                    </div>
                    <Link 
                        href="/admin/dashboard" 
                        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl text-sm font-medium w-fit"
                    >
                        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
                    </Link>
                </div>

                {/* Search Bar */}
                <form onSubmit={handleSearch} className="relative max-w-2xl">
                    <div className="relative flex items-center">
                        <Search className="absolute left-4 w-6 h-6 text-gray-500" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Enter User ID or Email address..."
                            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-14 pr-32 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all text-lg"
                        />
                        <button
                            type="submit"
                            disabled={isLoading || !query.trim()}
                            className="absolute right-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-6 py-2 rounded-xl font-medium transition-all disabled:opacity-50 flex items-center"
                        >
                            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search'}
                        </button>
                    </div>
                </form>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center space-x-3 max-w-2xl">
                        <AlertCircle className="w-5 h-5 text-red-400" />
                        <span className="text-red-200">{error}</span>
                    </div>
                )}
                
                {successMsg && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center space-x-3 max-w-2xl">
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                        <span className="text-green-200">{successMsg}</span>
                    </div>
                )}

                {/* Results Area */}
                {userData && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* User Details & Adjustment */}
                        <div className="lg:col-span-1 space-y-6">
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-3 opacity-20">
                                    <User className="w-24 h-24 text-purple-400" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-6 relative z-10">User Details</h3>
                                <div className="space-y-4 relative z-10">
                                    <div>
                                        <p className="text-sm text-gray-400 mb-1">Name</p>
                                        <p className="text-white font-medium">{userData.name || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-400 mb-1">Phone</p>
                                        <p className="text-white font-medium">{userData.phone || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <p className="text-sm text-gray-400">User ID</p>
                                            <button 
                                                onClick={() => setIsEditing(!isEditing)} 
                                                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                            >
                                                <Edit3 className="w-3 h-3" /> Edit Profile
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-300 font-mono break-all bg-black/20 p-2 rounded-lg border border-white/5">{userData.id}</p>
                                    </div>
                                    
                                    {isEditing && (
                                        <form onSubmit={handleUpdateProfile} className="mt-4 p-4 bg-black/20 rounded-xl border border-white/5 space-y-3">
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Full Name</label>
                                                <input
                                                    type="text"
                                                    value={editName}
                                                    onChange={(e) => setEditName(e.target.value)}
                                                    className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-white text-sm focus:border-blue-500/50 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Phone Number</label>
                                                <input
                                                    type="text"
                                                    value={editPhone}
                                                    onChange={(e) => setEditPhone(e.target.value)}
                                                    className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-white text-sm focus:border-blue-500/50 outline-none"
                                                />
                                            </div>
                                            <div className="flex gap-2 justify-end pt-2">
                                                <button type="button" onClick={() => setIsEditing(false)} className="text-xs text-gray-400 hover:text-white px-3 py-1">Cancel</button>
                                                <button type="submit" disabled={isSavingProfile} className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg flex items-center gap-1">
                                                    {isSavingProfile ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                                                </button>
                                            </div>
                                        </form>
                                    )}

                                    <div className="pt-4 border-t border-white/10 flex justify-between items-center">
                                        <div>
                                            <p className="text-sm text-gray-400 mb-1 flex items-center gap-1"><Trophy className="w-4 h-4 text-yellow-400"/> Points</p>
                                            <p className="text-2xl font-bold text-yellow-400">{userData.points?.toLocaleString()}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-gray-400 mb-1 flex items-center justify-end gap-1"><Wallet className="w-4 h-4 text-emerald-400"/> Wallet</p>
                                            <p className="text-2xl font-bold text-emerald-400">PKR {userData.walletBalance?.toLocaleString()}</p>
                                        </div>
                                    </div>
                                    <div className="pt-4 border-t border-white/10 grid grid-cols-2 gap-2">
                                        <button onClick={handleSuspend} disabled={isSuspending} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-2 rounded-xl text-xs font-medium flex justify-center items-center gap-1 transition-colors">
                                            {isSuspending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />} Suspend
                                        </button>
                                        <button onClick={handleResendVerification} disabled={isResendingVerify} className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 py-2 rounded-xl text-xs font-medium flex justify-center items-center gap-1 transition-colors">
                                            {isResendingVerify ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send Verification
                                        </button>
                                        <button onClick={handleImpersonate} disabled={isImpersonating} className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 py-2 rounded-xl text-xs font-medium flex justify-center items-center gap-1 transition-colors">
                                            {isImpersonating ? <Loader2 className="w-3 h-3 animate-spin" /> : <LinkIcon className="w-3 h-3" />} Login As
                                        </button>
                                        <button onClick={handleExportGDPR} disabled={isExporting} className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 py-2 rounded-xl text-xs font-medium flex justify-center items-center gap-1 transition-colors">
                                            {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} GDPR Export
                                        </button>
                                        
                                        <div className="col-span-2 mt-2">
                                            <button onClick={handleVerifyEmail} disabled={isVerifying} className="w-full bg-gray-500/10 hover:bg-gray-500/20 text-gray-400 border border-gray-500/20 py-1.5 rounded-xl text-[10px] uppercase font-bold tracking-wider flex justify-center items-center gap-1 transition-colors">
                                                {isVerifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertCircle className="w-3 h-3" />} Backup: Force Verify Email (Skip Validation)
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Adjustment Form */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <CreditCard className="w-5 h-5 text-blue-400" /> Adjust Balances
                                </h3>
                                <form onSubmit={handleAdjust} className="space-y-4">
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setAdjustType('points')}
                                            className={`py-2 rounded-xl text-sm font-medium transition-all ${adjustType === 'points' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50' : 'bg-white/5 text-gray-400 border border-transparent hover:bg-white/10'}`}
                                        >
                                            Points
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setAdjustType('wallet')}
                                            className={`py-2 rounded-xl text-sm font-medium transition-all ${adjustType === 'wallet' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50' : 'bg-white/5 text-gray-400 border border-transparent hover:bg-white/10'}`}
                                        >
                                            Wallet
                                        </button>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Amount (Use negative to deduct)</label>
                                        <input
                                            type="number"
                                            value={adjustAmount}
                                            onChange={(e) => setAdjustAmount(e.target.value)}
                                            placeholder="e.g. 500 or -100"
                                            className="w-full bg-black/20 border border-white/10 rounded-xl py-2 px-3 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Reason / Ticket ID</label>
                                        <input
                                            type="text"
                                            value={adjustReason}
                                            onChange={(e) => setAdjustReason(e.target.value)}
                                            placeholder="e.g. Compensation for missing quiz"
                                            className="w-full bg-black/20 border border-white/10 rounded-xl py-2 px-3 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={adjusting || !adjustAmount || !adjustReason}
                                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {adjusting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply Adjustment'}
                                    </button>
                                </form>
                            </div>

                            {/* Password Form */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <Key className="w-5 h-5 text-red-400" /> Reset Password
                                </h3>
                                <form onSubmit={handleUpdatePassword} className="space-y-4">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">New Password (Min 8 chars)</label>
                                        <input
                                            type="text"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            placeholder="Enter new strong password"
                                            className="w-full bg-black/20 border border-white/10 rounded-xl py-2 px-3 text-white placeholder-gray-600 focus:outline-none focus:border-red-500/50 transition-colors"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={isSavingPassword || newPassword.length < 8}
                                        className="w-full bg-red-600/80 hover:bg-red-600 text-white py-2 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {isSavingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Force Change Password'}
                                    </button>
                                </form>
                            </div>
                            
                            {/* Notification Form */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <Bell className="w-5 h-5 text-yellow-400" /> Send Notification
                                </h3>
                                <form onSubmit={handleSendNotification} className="space-y-4">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Title</label>
                                        <input
                                            type="text"
                                            value={notifTitle}
                                            onChange={(e) => setNotifTitle(e.target.value)}
                                            placeholder="e.g. Account Credited"
                                            className="w-full bg-black/20 border border-white/10 rounded-xl py-2 px-3 text-white placeholder-gray-600 focus:outline-none focus:border-yellow-500/50 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Message</label>
                                        <textarea
                                            value={notifMessage}
                                            onChange={(e) => setNotifMessage(e.target.value)}
                                            placeholder="Your detailed message..."
                                            rows={3}
                                            className="w-full bg-black/20 border border-white/10 rounded-xl py-2 px-3 text-white placeholder-gray-600 focus:outline-none focus:border-yellow-500/50 transition-colors resize-none"
                                        />
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={sendAsEmail}
                                            onChange={(e) => setSendAsEmail(e.target.checked)}
                                            className="w-4 h-4 rounded border-white/20 bg-black/50 text-yellow-500 focus:ring-yellow-500/50 focus:ring-offset-0 cursor-pointer accent-yellow-500"
                                        />
                                        <span className="text-sm text-gray-300 group-hover:text-white transition-colors flex items-center gap-2">
                                            <Mail className="w-4 h-4 text-gray-400" />
                                            Also send this message as an Email
                                        </span>
                                    </label>
                                    <button
                                        type="submit"
                                        disabled={isSendingNotif || !notifTitle || !notifMessage}
                                        className="w-full bg-yellow-600/80 hover:bg-yellow-600 text-white py-2 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {isSendingNotif ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Dispatch Message'}
                                    </button>
                                </form>
                            </div>
                        </div>

                        {/* History Tabs */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Quiz History */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                    <History className="w-6 h-6 text-indigo-400" /> Recent Quiz Activity
                                </h3>
                                {attempts.length === 0 ? (
                                    <p className="text-gray-500 text-center py-4">No recent quiz attempts found.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {attempts.map((attempt) => (
                                            <div key={attempt.id} className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5">
                                                <div>
                                                    <p className="text-white font-medium">{attempt.Quiz?.title || 'Unknown Quiz'}</p>
                                                    <p className="text-xs text-gray-400">{new Date(attempt.createdAt).toLocaleString()}</p>
                                                </div>
                                                <div className="text-right flex flex-col items-end gap-2">
                                                    <div>
                                                        <p className="text-sm text-gray-300">Score: {attempt.score} / {attempt.totalQuestions}</p>
                                                        <span className={`text-xs px-2 py-1 rounded-full ${attempt.isWinner ? 'bg-yellow-500/20 text-yellow-300' : 'bg-gray-500/20 text-gray-300'}`}>
                                                            {attempt.isWinner ? 'Winner' : 'Completed'}
                                                        </span>
                                                    </div>
                                                    <button 
                                                        onClick={() => handleRefund(attempt.id)}
                                                        disabled={refundingId === attempt.id}
                                                        className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-1 rounded-lg flex items-center gap-1 transition-colors"
                                                    >
                                                        {refundingId === attempt.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />} Refund & Delete
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Redemption History */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                    <Trophy className="w-6 h-6 text-yellow-400" /> Prize Redemptions
                                </h3>
                                {redemptions.length === 0 ? (
                                    <p className="text-gray-500 text-center py-4">No prize redemptions found.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {redemptions.map((red) => (
                                            <div key={red.id} className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5">
                                                <div>
                                                    <p className="text-white font-medium">{red.Prize?.name || 'Unknown Prize'}</p>
                                                    <p className="text-xs text-gray-400">{new Date(red.createdAt).toLocaleString()}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm text-yellow-400 font-medium">- {red.pointsUsed} points</p>
                                                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${
                                                        red.status === 'completed' ? 'bg-green-500/20 text-green-300' :
                                                        red.status === 'rejected' ? 'bg-red-500/20 text-red-300' :
                                                        'bg-yellow-500/20 text-yellow-300'
                                                    }`}>
                                                        {red.status}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            
                            {/* Security Logs */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                    <ShieldAlert className="w-6 h-6 text-red-400" /> Recent Security & Action Logs
                                </h3>
                                {securityLogs.length === 0 ? (
                                    <p className="text-gray-500 text-center py-4">No recent security logs found.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {securityLogs.map((log) => (
                                            <div key={log.id} className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5">
                                                <div>
                                                    <p className="text-white font-medium">{log.type}</p>
                                                    <p className="text-xs text-gray-400 font-mono mt-1 max-w-xs truncate">{JSON.stringify(log.details)}</p>
                                                </div>
                                                <div className="text-right whitespace-nowrap ml-4">
                                                    <p className="text-xs text-gray-400">{new Date(log.createdAt).toLocaleString()}</p>
                                                    <span className={`text-[10px] uppercase px-2 py-1 rounded-full mt-2 inline-block ${
                                                        log.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-300' :
                                                        log.severity === 'HIGH' ? 'bg-orange-500/20 text-orange-300' :
                                                        log.severity === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-300' :
                                                        'bg-blue-500/20 text-blue-300'
                                                    }`}>
                                                        {log.severity}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Internal Admin Notes */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                    <FileText className="w-6 h-6 text-indigo-400" /> Internal Admin Notes (CRM)
                                </h3>
                                
                                <form onSubmit={handleAddNote} className="mb-6 p-4 bg-black/20 rounded-xl border border-white/5 space-y-3">
                                    <textarea
                                        value={newNote}
                                        onChange={(e) => setNewNote(e.target.value)}
                                        placeholder="Add a private note about this user (e.g. Warning issued for abusive language)"
                                        rows={2}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-white text-sm focus:border-indigo-500/50 outline-none resize-none"
                                    />
                                    <div className="flex gap-2 items-center">
                                        <Tag className="w-4 h-4 text-gray-500" />
                                        <input
                                            type="text"
                                            value={newTag}
                                            onChange={(e) => setNewTag(e.target.value)}
                                            placeholder="Tags (comma separated, e.g. VIP, Suspicious)"
                                            className="flex-1 bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-white text-sm focus:border-indigo-500/50 outline-none"
                                        />
                                        <button type="submit" disabled={isSavingNote || !newNote} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg flex items-center gap-1 transition-colors disabled:opacity-50">
                                            {isSavingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Add Note
                                        </button>
                                    </div>
                                </form>

                                {adminNotes.length === 0 ? (
                                    <p className="text-gray-500 text-center py-4">No internal notes for this user.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {adminNotes.map((note) => (
                                            <div key={note.id} className="p-4 bg-black/20 rounded-xl border border-white/5">
                                                <div className="flex justify-between items-start mb-2">
                                                    <p className="text-white text-sm">{note.details.note}</p>
                                                    <p className="text-[10px] text-gray-500 ml-4 whitespace-nowrap">{new Date(note.createdAt).toLocaleString()}</p>
                                                </div>
                                                <div className="flex justify-between items-center mt-3 pt-3 border-t border-white/5">
                                                    <div className="flex gap-1 flex-wrap">
                                                        {note.details.tags?.map((t: string, i: number) => (
                                                            <span key={i} className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-md border border-indigo-500/20">{t}</span>
                                                        ))}
                                                    </div>
                                                    <p className="text-[10px] text-gray-500">By {note.details.adminEmail}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
