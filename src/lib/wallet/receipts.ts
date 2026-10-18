import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Deposit proof screenshots, stored in the PRIVATE `receipts` bucket
 * (supabase/migrations/20261018160000_receipts_bucket.sql).
 *
 * WalletTransaction."proofImage" holds "receipts/<auth uid>/<file>", never a public URL: the
 * screenshots show account details. The admin wallet page gets short-lived signed links.
 */
export const RECEIPTS_BUCKET = 'receipts';
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
/** Signed links on the admin page last an hour. */
export const RECEIPT_LINK_SECONDS = 60 * 60;

const REF_PREFIX = `${RECEIPTS_BUCKET}/`;
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** File extension for an accepted screenshot type (the bucket allows only these); null otherwise. */
export function receiptExtension(mimeType: string): string | null {
  return EXTENSIONS[mimeType] ?? null;
}

/** The value saved in "proofImage" for an object path inside the bucket. */
export function receiptRef(path: string): string {
  return `${REF_PREFIX}${path}`;
}

/**
 * Object path of a stored receipt reference, only if it sits in `userId`'s own folder.
 * Someone calling the deposit RPC directly can't make the admin page show another player's
 * receipt this way.
 */
export function receiptPathFor(value: string | null | undefined, userId: string): string | null {
  if (!value?.startsWith(REF_PREFIX)) return null;
  const path = value.slice(REF_PREFIX.length);
  const [folder, ...rest] = path.split('/');
  if (folder !== userId || rest.length !== 1 || !rest[0] || rest[0] === '.' || rest[0] === '..') return null;
  return path;
}

/**
 * Replaces each transaction's receipt reference with a signed link (one request for the page).
 * Older full https URLs pass through; anything else becomes null.
 */
export async function withSignedReceipts<T extends { userId: string; proofImage?: string | null }>(
  client: Pick<SupabaseClient, 'storage'>,
  transactions: T[],
): Promise<T[]> {
  const paths = transactions
    .map((tx) => receiptPathFor(tx.proofImage, tx.userId))
    .filter((path): path is string => path !== null);

  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data, error } = await client.storage.from(RECEIPTS_BUCKET).createSignedUrls(paths, RECEIPT_LINK_SECONDS);
    if (error) console.error('[receipts] could not sign receipt links:', error);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl && !item.error) signed.set(item.path, item.signedUrl);
    }
  }

  return transactions.map((tx) => {
    const path = receiptPathFor(tx.proofImage, tx.userId);
    const proofImage = path
      ? signed.get(path) ?? null
      : tx.proofImage?.startsWith('https://') ? tx.proofImage : null;
    return { ...tx, proofImage };
  });
}
