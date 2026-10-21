-- =============================================================================
-- Support tickets raised through the AI chatbot
--
-- Applied to the Mumbai project (eclivawqhdovsndlngfo) on 2026-10-21 as migration 20261021033658
-- support_tickets, for testing. NOT applied to Tokyo (production). It must run on the live project
-- before the code that uses it is deployed: until then the chatbot can't create or look up tickets
-- (it tells the player it couldn't, and the rest of the chat works) and /admin/tickets shows a load
-- error.
--
-- A signed-in player who has a problem the bot can't solve asks it to send the problem to the
-- admins. The server (service role, after its auth() check) calls create_support_ticket(), which
-- returns a ticket number like TKT-7KQ2XM. The player asks the bot about that number later and gets
-- the status and the admin's reply. Admins work the tickets in /admin/tickets.
--
-- Only the service role reads or writes this table: players never query it directly (the server
-- checks ownership with the session's user id), so RLS is on with no policies and anon /
-- authenticated get no privileges. Rows are never deleted by the app; they go with their player.
--
-- Safe to re-run.
-- =============================================================================

-- 1. Table ---------------------------------------------------------------------------------------
-- Ticket numbers use an alphabet without look-alikes (no I, O, 0 or 1): 32^6 ≈ 1.07 billion values.
-- "adminReply" is shown to the player; "repliedBy" (the admin's email) is not.
CREATE TABLE IF NOT EXISTS public."SupportTicket" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticketNumber" text NOT NULL UNIQUE CHECK ("ticketNumber" ~ '^TKT-[A-HJ-NP-Z2-9]{6}$'),
  "userId" text NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 120),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])),
  "adminReply" text CHECK ("adminReply" IS NULL OR char_length("adminReply") <= 2000),
  "repliedAt" timestamp with time zone,
  "repliedBy" text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."SupportTicket" IS
  'Player problems sent to the admins through the chatbot. Service role only; see create_support_ticket().';

-- A player's own tickets, newest first (chatbot lookups and the rate limit below)
CREATE INDEX IF NOT EXISTS "SupportTicket_userId_createdAt_idx"
  ON public."SupportTicket" USING btree ("userId", "createdAt" DESC);
-- The admin list, filtered by status, newest first
CREATE INDEX IF NOT EXISTS "SupportTicket_status_createdAt_idx"
  ON public."SupportTicket" USING btree (status, "createdAt" DESC);

ALTER TABLE public."SupportTicket" ENABLE ROW LEVEL SECURITY;
-- New public tables get no grants on this project, and the server needs these three. Revoking from
-- anon/authenticated as well covers a project whose default privileges do grant them.
REVOKE ALL ON public."SupportTicket" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public."SupportTicket" TO service_role;

-- 2. Ticket numbers ------------------------------------------------------------------------------
-- 'TKT-' plus 6 random characters. Not a secret (every lookup is limited to the owner's tickets),
-- just short and easy to read out.
CREATE OR REPLACE FUNCTION public.support_ticket_number()
 RETURNS text
 LANGUAGE sql
 VOLATILE
 SET search_path TO 'public'
AS $function$
  SELECT 'TKT-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
    FROM generate_series(1, 6)
$function$;
REVOKE ALL ON FUNCTION public.support_ticket_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_ticket_number() TO service_role;

-- 3. Creating a ticket ---------------------------------------------------------------------------
-- Rate limit, per player: at most 3 new tickets in any hour, and at most 5 unresolved (open or in
-- progress) at once. It locks the player's row first, so two requests sent together run one after
-- the other and the second one sees the first ticket.
--
-- p_user_id is trusted: only the service role may call this, and the server passes the id from the
-- signed-in session. Returns {success: true, ticket: {...}} or {success: false, code, error}.
CREATE OR REPLACE FUNCTION public.create_support_ticket(p_user_id text, p_subject text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_last_hour integer;
  v_unresolved integer;
  v_ticket "SupportTicket";
BEGIN
  IF v_subject = '' OR v_message = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid',
      'error', 'A ticket needs a subject and a description.');
  END IF;

  PERFORM 1 FROM "User" WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'no_user', 'error', 'Player not found.');
  END IF;

  SELECT count(*) FILTER (WHERE "createdAt" > now() - interval '1 hour'),
         count(*) FILTER (WHERE status = ANY (ARRAY['open', 'in_progress']))
    INTO v_last_hour, v_unresolved
    FROM "SupportTicket"
   WHERE "userId" = p_user_id;

  IF v_last_hour >= 3 THEN
    RETURN jsonb_build_object('success', false, 'code', 'rate_limited',
      'error', 'You have sent 3 tickets in the last hour. Please wait a while before sending another.');
  END IF;
  IF v_unresolved >= 5 THEN
    RETURN jsonb_build_object('success', false, 'code', 'too_many_open',
      'error', 'You already have 5 tickets waiting for an answer. Please wait for those first.');
  END IF;

  -- A clash with an existing number is a one-in-a-billion event: try another number
  FOR i IN 1..10 LOOP
    INSERT INTO "SupportTicket" ("ticketNumber", "userId", subject, message)
    VALUES (support_ticket_number(), p_user_id, v_subject, v_message)
    ON CONFLICT ("ticketNumber") DO NOTHING
    RETURNING * INTO v_ticket;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'ticket', to_jsonb(v_ticket));
    END IF;
  END LOOP;
  RAISE EXCEPTION 'create_support_ticket: no free ticket number after 10 tries';
END;
$function$;
REVOKE ALL ON FUNCTION public.create_support_ticket(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text, text) TO service_role;
