-- =============================================================================
-- Claim tracking: pin the search_path of its three pure helper functions
--
-- NOT applied to any database yet. Needs the owner's approval for production (eclivawqhdovsndlngfo).
-- Applies before or after PR #79's code is deployed: nothing the code sees changes.
--
-- Why: Supabase's security advisor (function_search_path_mutable) flagged three functions that
-- 20261028120000_claim_tracking added without a fixed search_path: claim_tracking_check_char,
-- normalize_pk_phone and claim_address_key. They call only built-in functions, which resolve from
-- pg_catalog first unless a caller puts another schema ahead of it. An empty search_path rules that
-- out, as the project's other functions pin theirs. Their results don't change, so the indexes built on
-- normalize_pk_phone and claim_address_key stay valid.
--
-- Safe to re-run.
-- =============================================================================

ALTER FUNCTION private_hardened.claim_tracking_check_char(text) SET search_path = '';
ALTER FUNCTION private_hardened.normalize_pk_phone(text) SET search_path = '';
ALTER FUNCTION private_hardened.claim_address_key(text) SET search_path = '';
