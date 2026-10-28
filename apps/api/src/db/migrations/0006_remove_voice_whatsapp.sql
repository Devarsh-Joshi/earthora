-- Remove the voice agent and WhatsApp agent from the database (28 October 2026).
-- Their code was deleted; the website chat assistant is the only AI channel.
--
-- Drops every voice/WhatsApp table and function, whether it came from this API's
-- own migrations (0003-0005, inbound_events) or from the Supabase schema files the
-- VPS database was built from (voice_*, whatsapp_*). Orders, payments, products,
-- product knowledge and chat conversations are kept. Everything is IF EXISTS so
-- the migration is safe on databases that never had a given object.

-- ── Product knowledge keeps its updated_at trigger on the generic function ────
DO $$
BEGIN
  IF to_regclass('public.product_knowledge') IS NOT NULL
     AND to_regprocedure('public.update_updated_at_column()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS update_product_knowledge_modtime ON public.product_knowledge;
    CREATE TRIGGER update_product_knowledge_modtime BEFORE UPDATE ON public.product_knowledge
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- ── Voice and WhatsApp tables (children first) ─────────────────────────────────
DROP TABLE IF EXISTS public.whatsapp_sessions;
DROP TABLE IF EXISTS public.whatsapp_message_events;
DROP TABLE IF EXISTS public.whatsapp_agent_sessions;
DROP TABLE IF EXISTS public.whatsapp_agent_locks;
DROP TABLE IF EXISTS public.voice_checkout_items;
DROP TABLE IF EXISTS public.voice_checkout_sessions;
DROP TABLE IF EXISTS public.voice_call_sessions;
DROP TABLE IF EXISTS public.voice_request_drafts;
DROP TABLE IF EXISTS public.studio_voice_requests;
DROP TABLE IF EXISTS public.studio_email_receipts;
DROP TABLE IF EXISTS public.inbound_events;

-- ── Voice and WhatsApp functions (every overload) ──────────────────────────────
DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname ILIKE '%whatsapp%'
           OR p.proname IN ('finalize_voice_order', 'update_voice_updated_at_column'))
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', fn);
  END LOOP;
END $$;

-- ── Chat-only AI platform ──────────────────────────────────────────────────────
-- Conversation history is kept; conversations.channel_id becomes NULL for the
-- removed channels (ON DELETE SET NULL).
DELETE FROM channels WHERE type <> 'chat';
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check CHECK (type = 'chat');

UPDATE functions SET allowed_channels = ARRAY(SELECT c FROM unnest(allowed_channels) AS c WHERE c = 'chat')
  WHERE NOT allowed_channels <@ ARRAY['chat'];
ALTER TABLE functions ALTER COLUMN allowed_channels SET DEFAULT '{chat}';

-- WhatsApp user IDs on contacts (the unique constraint goes with the column).
ALTER TABLE contacts DROP COLUMN IF EXISTS wa_id;
