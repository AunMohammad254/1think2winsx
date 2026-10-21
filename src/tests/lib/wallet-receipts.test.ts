// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  MAX_RECEIPT_BYTES,
  RECEIPTS_BUCKET,
  receiptExtension,
  receiptPathFor,
  receiptRef,
  withSignedReceipts,
} from '@/lib/wallet/receipts';

const clientWith = (createSignedUrls: (...a: unknown[]) => unknown) => {
  const bucket = { createSignedUrls: vi.fn(createSignedUrls) };
  return { client: { storage: { from: vi.fn(() => bucket) } } as never, bucket };
};

describe('receipt references', () => {
  it('maps accepted screenshot types to extensions and refuses the rest', () => {
    expect(receiptExtension('image/jpeg')).toBe('jpg');
    expect(receiptExtension('image/png')).toBe('png');
    expect(receiptExtension('image/webp')).toBe('webp');
    for (const type of ['image/gif', 'image/heic', 'image/svg+xml', 'application/pdf', '']) expect(receiptExtension(type)).toBeNull();
    expect(MAX_RECEIPT_BYTES).toBe(5 * 1024 * 1024);
    expect(RECEIPTS_BUCKET).toBe('receipts');
  });

  it('reads back only references inside the owner\'s own folder', () => {
    expect(receiptRef('user-1/1_a.png')).toBe('receipts/user-1/1_a.png');
    expect(receiptPathFor('receipts/user-1/1_a.png', 'user-1')).toBe('user-1/1_a.png');
    for (const value of [
      'receipts/user-2/1_a.png', // another player's folder
      'receipts/user-1/nested/1_a.png',
      'receipts/user-1/',
      'receipts/user-1/..',
      'receipts/user-1/.',
      'receipts/user-1',
      'https://proj.supabase.co/storage/v1/object/public/receipts/user-1/1_a.png',
      '',
      null,
      undefined,
    ]) {
      expect(receiptPathFor(value, 'user-1')).toBeNull();
    }
  });
});

describe('withSignedReceipts', () => {
  it('signs every own-folder receipt in one request and keeps older https links', async () => {
    const { client, bucket } = clientWith(async (paths) => ({
      data: [
        ...(paths as string[]).map((p) => ({ path: p, signedUrl: `https://signed/${p}`, error: null })),
        { path: null, signedUrl: null, error: 'not found' },
      ],
      error: null,
    }));
    const out = await withSignedReceipts(client, [
      { id: 1, userId: 'u1', proofImage: 'receipts/u1/a.png' },
      { id: 2, userId: 'u2', proofImage: 'receipts/u2/b.png' },
      { id: 3, userId: 'u3', proofImage: 'https://old.example/c.png' },
      { id: 4, userId: 'u4', proofImage: 'http://insecure.example/d.png' },
      { id: 5, userId: 'u5', proofImage: null },
      { id: 6, userId: 'u6' },
    ]);
    expect(bucket.createSignedUrls).toHaveBeenCalledWith(['u1/a.png', 'u2/b.png'], 3600);
    expect(out.map((t) => t.proofImage)).toEqual(['https://signed/u1/a.png', 'https://signed/u2/b.png', 'https://old.example/c.png', null, null, null]);
    expect(out[0]).toMatchObject({ id: 1, userId: 'u1' });
  });

  it('skips the request when nothing needs signing, and hides links it could not sign', async () => {
    const { client, bucket } = clientWith(async () => ({ data: null, error: null }));
    expect(await withSignedReceipts(client, [{ userId: 'u', proofImage: null }])).toEqual([{ userId: 'u', proofImage: null }]);
    expect(bucket.createSignedUrls).not.toHaveBeenCalled();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = clientWith(async () => ({ data: null, error: { message: 'bucket not found' } }));
    expect((await withSignedReceipts(failing.client, [{ userId: 'u', proofImage: 'receipts/u/a.png' }]))[0].proofImage).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('[receipts] could not sign receipt links:', { message: 'bucket not found' });
    const partial = clientWith(async () => ({ data: [{ path: 'u/a.png', signedUrl: 'https://signed/u/a.png', error: 'expired' }], error: null }));
    expect((await withSignedReceipts(partial.client, [{ userId: 'u', proofImage: 'receipts/u/a.png' }]))[0].proofImage).toBeNull();
    errorSpy.mockRestore();
  });
});
