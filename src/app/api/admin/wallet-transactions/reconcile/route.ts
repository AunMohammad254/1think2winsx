import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { getAdminDb, notificationDb } from '@/lib/supabase/db';
import * as pdfParseModule from 'pdf-parse';

// ============================================================================
// Statement Entry — extracted from bank statement
// ============================================================================
interface StatementEntry {
    transactionId?: string;
    amount?: number;
    date?: Date;
    rawLine: string;
}

// ============================================================================
// Parsers for Easypaisa / Jazzcash / CSV / Generic
// ============================================================================

/**
 * Parse Easypaisa SMS/statement format:
 * Examples:
 *  "PKR 500 received from 0312XXXXXXX. Ref# 7263652728817 at 10:22PM"
 *  "You have received Rs. 100 from 0301-1234567. TxnID: 7263652728817"
 *  "Easypaisa: Rs 200 credited. Ref: 8372946182736"
 */
function parseEasypaisaLine(line: string): StatementEntry | null {
    const entry: StatementEntry = { rawLine: line };

    // Amount patterns
    const amountPatterns = [
        /(?:PKR|Rs\.?|Rs)\s*([\d,]+(?:\.\d{1,2})?)/i,
        /([\d,]+(?:\.\d{1,2})?)\s*(?:PKR|Rs)/i,
    ];
    for (const pat of amountPatterns) {
        const m = line.match(pat);
        if (m) {
            entry.amount = parseFloat(m[1].replace(/,/g, ''));
            break;
        }
    }

    // Transaction ID / Reference patterns
    const refPatterns = [
        /(?:Ref#?|TxnID:|Transaction(?:\s+ID)?:|Reference(?:\s+No\.?)?:|ID:|Ref\s*No\.?)\s*([A-Z0-9]{8,20})/i,
        /\b([0-9]{10,16})\b/, // bare 10-16 digit number
    ];
    for (const pat of refPatterns) {
        const m = line.match(pat);
        if (m) {
            entry.transactionId = m[1].trim();
            break;
        }
    }

    // Date patterns
    const datePatterns = [
        /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/,
        /\b(\d{4}-\d{2}-\d{2})\b/,
        /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})\b/i,
    ];
    for (const pat of datePatterns) {
        const m = line.match(pat);
        if (m) {
            const parsed = new Date(m[1]);
            if (!isNaN(parsed.getTime())) {
                entry.date = parsed;
                break;
            }
        }
    }

    if (!entry.amount && !entry.transactionId) return null;
    return entry;
}

/**
 * Parse Jazzcash statement format:
 * "Transaction ID: JC1234567890  Amount: PKR 150.00  Date: 15-Jan-2026"
 * "JC9876543210|250.00|2026-01-15|Received"
 */
function parseJazzcashLine(line: string): StatementEntry | null {
    const entry: StatementEntry = { rawLine: line };

    // Jazzcash TxID usually starts with JC
    const jcMatch = line.match(/\b(JC[0-9A-Z]{8,18})\b/i);
    if (jcMatch) entry.transactionId = jcMatch[1];

    // CSV pipe-delimited format: JC123|250.00|2026-01-15|...
    const pipeMatch = line.match(/^([A-Z0-9]+)\|([\d.]+)\|([\d-]+)/i);
    if (pipeMatch) {
        entry.transactionId = pipeMatch[1];
        entry.amount = parseFloat(pipeMatch[2]);
        const parsed = new Date(pipeMatch[3]);
        if (!isNaN(parsed.getTime())) entry.date = parsed;
        return entry;
    }

    // Amount
    const amountMatch = line.match(/(?:Amount|PKR|Rs\.?)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (amountMatch) entry.amount = parseFloat(amountMatch[1].replace(/,/g, ''));

    // Date
    const dateMatch = line.match(/\b(\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4})\b/i);
    if (dateMatch) {
        const parsed = new Date(dateMatch[1]);
        if (!isNaN(parsed.getTime())) entry.date = parsed;
    }

    if (!entry.amount && !entry.transactionId) return null;
    return entry;
}

/**
 * Parse CSV format: columns may include Date, Description, Reference, Amount
 * Handles standard bank CSV exports with headers.
 */
function parseCSVContent(text: string): StatementEntry[] {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const entries: StatementEntry[] = [];
    const header = lines[0].toLowerCase();
    const isCSV = header.includes(',') || header.includes(';') || header.includes('|');

    if (!isCSV) return [];

    const sep = header.includes(';') ? ';' : header.includes('|') ? '|' : ',';
    const cols = header.split(sep).map(c => c.trim().replace(/"/g, ''));

    // Map common column names
    const colMap = {
        amount: cols.findIndex(c => /amount|credit|debit|value|pkr/i.test(c)),
        ref: cols.findIndex(c => /ref|transaction.?id|txn|reference|id/i.test(c)),
        date: cols.findIndex(c => /date|time/i.test(c)),
        desc: cols.findIndex(c => /desc|narration|particular|detail/i.test(c)),
    };

    for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(sep).map(v => v.trim().replace(/"/g, ''));
        const entry: StatementEntry = { rawLine: lines[i] };

        if (colMap.amount >= 0 && vals[colMap.amount]) {
            const a = parseFloat(vals[colMap.amount].replace(/,/g, ''));
            if (!isNaN(a) && a > 0) entry.amount = a;
        }
        if (colMap.ref >= 0 && vals[colMap.ref]) {
            entry.transactionId = vals[colMap.ref].trim();
        }
        if (colMap.date >= 0 && vals[colMap.date]) {
            const parsed = new Date(vals[colMap.date]);
            if (!isNaN(parsed.getTime())) entry.date = parsed;
        }

        if (entry.amount || entry.transactionId) entries.push(entry);
    }

    return entries;
}

/**
 * Main parser — tries all formats and returns merged results
 */
function parseStatementText(text: string, filename: string): StatementEntry[] {
    const results: StatementEntry[] = [];

    // Try CSV first for .csv files
    if (filename.endsWith('.csv')) {
        const csvEntries = parseCSVContent(text);
        if (csvEntries.length > 0) return csvEntries;
    }

    // Try generic CSV detection
    const firstLine = text.split('\n')[0];
    if (firstLine.includes(',') || firstLine.includes(';') || firstLine.includes('|')) {
        const csvEntries = parseCSVContent(text);
        if (csvEntries.length > 0) return csvEntries;
    }

    // Line-by-line parsing for PDFs, TXTs, SMS exports
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 5);
    const isJazzcash = /jazzcash/i.test(text.substring(0, 500));

    for (const line of lines) {
        const entry = isJazzcash ? parseJazzcashLine(line) : parseEasypaisaLine(line);
        if (entry && (entry.transactionId || entry.amount)) {
            results.push(entry);
        }
    }

    // Deduplicate by transactionId
    const seen = new Set<string>();
    return results.filter(e => {
        if (!e.transactionId) return true;
        if (seen.has(e.transactionId)) return false;
        seen.add(e.transactionId);
        return true;
    });
}

// ============================================================================
// Matching logic
// ============================================================================
interface PendingTx {
    id: string;
    transactionId: string;
    amount: number;
    paymentMethod: string;
    createdAt: string;
    userId: string;
}

interface MatchResult {
    pendingTx: PendingTx;
    statementEntry: StatementEntry;
    matchType: 'exact_id' | 'amount_date';
    confidence: 'high' | 'medium';
}

function matchTransactions(pending: PendingTx[], entries: StatementEntry[]): MatchResult[] {
    const matches: MatchResult[] = [];
    const matchedPendingIds = new Set<string>();
    const matchedEntryIndexes = new Set<number>();

    // Pass 1: Exact transaction ID match (high confidence)
    for (const tx of pending) {
        if (matchedPendingIds.has(tx.id)) continue;
        for (let i = 0; i < entries.length; i++) {
            if (matchedEntryIndexes.has(i)) continue;
            const entry = entries[i];
            if (
                entry.transactionId &&
                tx.transactionId &&
                entry.transactionId.toLowerCase() === tx.transactionId.toLowerCase()
            ) {
                matches.push({
                    pendingTx: tx,
                    statementEntry: entry,
                    matchType: 'exact_id',
                    confidence: 'high',
                });
                matchedPendingIds.add(tx.id);
                matchedEntryIndexes.add(i);
                break;
            }
        }
    }

    // Pass 2: Amount + date window match (medium confidence, 24h window)
    for (const tx of pending) {
        if (matchedPendingIds.has(tx.id)) continue;
        const txDate = new Date(tx.createdAt);
        for (let i = 0; i < entries.length; i++) {
            if (matchedEntryIndexes.has(i)) continue;
            const entry = entries[i];
            if (!entry.amount || !entry.date) continue;

            const amountMatch = Math.abs(entry.amount - tx.amount) < 0.01;
            const timeDiff = Math.abs(entry.date.getTime() - txDate.getTime());
            const within24h = timeDiff <= 24 * 60 * 60 * 1000;

            if (amountMatch && within24h) {
                matches.push({
                    pendingTx: tx,
                    statementEntry: entry,
                    matchType: 'amount_date',
                    confidence: 'medium',
                });
                matchedPendingIds.add(tx.id);
                matchedEntryIndexes.add(i);
                break;
            }
        }
    }

    return matches;
}

// ============================================================================
// API Route
// ============================================================================
export async function POST(request: NextRequest) {
    try {
        const adminSession = await validateAdminSession();
        if (!adminSession.valid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        // Optional: auto_approve flag (defaults to false for safety, admin can pass true)
        const autoApprove = formData.get('auto_approve') === 'true';

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        // --- Extract text ---
        const buffer = Buffer.from(await file.arrayBuffer());
        let textContent = '';

        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
            try {
                const parsePdf = (pdfParseModule as any).default || pdfParseModule;
                const pdfData = await parsePdf(buffer);
                textContent = pdfData.text;
            } catch (err) {
                console.error('Failed to parse PDF:', err);
                return NextResponse.json({ error: 'Failed to parse PDF file' }, { status: 500 });
            }
        } else {
            textContent = buffer.toString('utf-8');
        }

        if (!textContent.trim()) {
            return NextResponse.json({ error: 'Could not extract text from file' }, { status: 400 });
        }

        // --- Parse statement ---
        const statementEntries = parseStatementText(textContent, file.name);

        if (statementEntries.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No recognizable transactions found in the statement.',
                statementEntriesFound: 0,
                matchedIds: [],
                autoApproved: [],
                unmatchedPending: [],
            });
        }

        // --- Fetch pending transactions ---
        const adminDb = getAdminDb();
        const { data: pendingTxs, error: fetchError } = await adminDb
            .from('WalletTransaction')
            .select('id, transactionId, amount, paymentMethod, createdAt, userId')
            .eq('status', 'pending')
            .gt('amount', 0); // Only deposits

        if (fetchError) {
            console.error('Failed to fetch pending transactions:', fetchError);
            return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
        }

        if (!pendingTxs || pendingTxs.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No pending deposit transactions to match against.',
                statementEntriesFound: statementEntries.length,
                matchedIds: [],
                autoApproved: [],
                unmatchedPending: [],
            });
        }

        // --- Match ---
        const matches = matchTransactions(pendingTxs as PendingTx[], statementEntries);
        const matchedIds = matches.map(m => m.pendingTx.id);
        const autoApproved: string[] = [];
        const approvalErrors: { id: string; error: string }[] = [];

        // --- Auto-approve if requested ---
        if (autoApprove && matches.length > 0) {
            for (const match of matches) {
                try {
                    // Use approve RPC for atomicity
                    const { data, error } = await adminDb.rpc('approve_wallet_transaction', {
                        p_transaction_id: match.pendingTx.id,
                        p_processed_by: `reconcile:${adminSession.email || 'admin'}`,
                    });

                    if (error || !(data as { success?: boolean } | null)?.success) {
                        // Fallback to direct update
                        const { error: updateError } = await adminDb
                            .from('WalletTransaction')
                            .update({
                                status: 'approved',
                                processedBy: `reconcile:${adminSession.email || 'admin'}`,
                                processedAt: new Date().toISOString(),
                                adminNotes: `Auto-approved via statement reconciliation. Match type: ${match.matchType}. Confidence: ${match.confidence}.`,
                                updatedAt: new Date().toISOString(),
                            })
                            .eq('id', match.pendingTx.id)
                            .eq('status', 'pending');

                        if (updateError) {
                            approvalErrors.push({ id: match.pendingTx.id, error: updateError.message });
                            continue;
                        }
                    }

                    autoApproved.push(match.pendingTx.id);

                    // Send notification
                    try {
                        await notificationDb.create(match.pendingTx.userId, {
                            title: 'Deposit Approved',
                            message: `Your deposit of PKR ${match.pendingTx.amount} has been approved via bank statement reconciliation.`,
                            type: 'wallet_deposit',
                            link: '/profile/wallet',
                        });
                    } catch (notifErr) {
                        console.error('Notification error:', notifErr);
                    }
                } catch (err) {
                    approvalErrors.push({
                        id: match.pendingTx.id,
                        error: err instanceof Error ? err.message : 'Unknown error',
                    });
                }
            }
        }

        // --- Unmatched pending ---
        const matchedPendingIdSet = new Set(matchedIds);
        const unmatchedPending = (pendingTxs as PendingTx[])
            .filter(tx => !matchedPendingIdSet.has(tx.id))
            .map(tx => ({
                id: tx.id,
                transactionId: tx.transactionId,
                amount: tx.amount,
                paymentMethod: tx.paymentMethod,
                createdAt: tx.createdAt,
            }));

        const matchDetails = matches.map(m => ({
            pendingId: m.pendingTx.id,
            transactionId: m.pendingTx.transactionId,
            amount: m.pendingTx.amount,
            matchType: m.matchType,
            confidence: m.confidence,
            statementRef: m.statementEntry.transactionId,
            statementAmount: m.statementEntry.amount,
            autoApproved: autoApproved.includes(m.pendingTx.id),
        }));

        return NextResponse.json({
            success: true,
            message: autoApprove
                ? `Matched ${matches.length} transaction(s). Auto-approved ${autoApproved.length}. ${unmatchedPending.length} still pending review.`
                : `Found ${matches.length} matching transaction(s). ${unmatchedPending.length} pending transactions unmatched.`,
            statementEntriesFound: statementEntries.length,
            matchedIds,
            matchDetails,
            autoApproved,
            approvalErrors,
            unmatchedPending,
        });
    } catch (error) {
        console.error('Error reconciling bank statement:', error);
        return NextResponse.json(
            { error: 'Failed to process reconciliation' },
            { status: 500 }
        );
    }
}
