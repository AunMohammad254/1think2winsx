-- =============================================================================
-- Private `receipts` bucket for wallet deposit proofs
--
-- src/app/profile/wallet/actions.ts uploads each deposit's payment screenshot to
-- receipts/<player's auth uid>/<file>, but production has no such bucket, so deposits would fail
-- as soon as the wallet is turned back on.
--
-- Payment screenshots show account names, numbers and amounts, so this bucket is PRIVATE: there
-- are no public URLs. WalletTransaction."proofImage" stores "receipts/<uid>/<file>", and the admin
-- wallet page gets a short-lived signed link from the server (service role).
--
--   players  may upload into their own folder and read their own files; they cannot replace
--            or delete a receipt once it is sent (it is evidence for the admin)
--   anon     nothing
--   admins   through the server's service role only
--
-- Safe to re-run. Changes no existing rows or files.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])  -- 5 MB
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Policies from the old SQL/05_patches_fixes/add_proof_image.sql (any player could upload anywhere
-- in the bucket, anyone could read every receipt). Not present in production on 2026-10-18;
-- dropped here so they can never come back alongside the new ones.
drop policy if exists "Users can upload receipts" on storage.objects;
drop policy if exists "Public can view receipts" on storage.objects;

drop policy if exists "receipts_owner_insert" on storage.objects;
create policy "receipts_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "receipts_owner_select" on storage.objects;
create policy "receipts_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
