/**
 * Copies prize images from Cloudinary into Supabase Storage (the prize-images bucket).
 *
 *   bun supabase/data-migrations/migrate-cloudinary-images.ts            dry run: lists what would move
 *   bun supabase/data-migrations/migrate-cloudinary-images.ts --apply    copies them and updates the prizes
 *
 * Run it only after supabase/migrations/20261018150000_media_storage.sql is applied.
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local or .env;
 * never printed). Cloudinary files are never deleted, so every old link keeps working, and the
 * "from" URLs it prints are the undo list (put one back on its prize to revert).
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { migratePrizeImagesFromCloudinary } from '../../src/lib/media/cloudinary-migration';

config({ path: '.env.local', quiet: true });
config({ quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (for example in .env.local).');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`${apply ? 'COPYING' : 'Dry run (nothing changes)'}: prize images on Cloudinary -> ${new URL(url).host} prize-images`);
const moves = await migratePrizeImagesFromCloudinary(db, { apply });
if (moves.length === 0) console.log('No prize uses a Cloudinary image.');
for (const move of moves) {
  console.log(`\n${move.name} (${move.prizeId})\n  from: ${move.from}`);
  if (move.to) console.log(`  to:   ${move.to}`);
  if (move.error) console.log(`  FAILED: ${move.error}`);
}
if (!apply && moves.length > 0) console.log('\nRun again with --apply to copy these.');
process.exit(moves.some((m) => m.error) ? 1 : 0);
