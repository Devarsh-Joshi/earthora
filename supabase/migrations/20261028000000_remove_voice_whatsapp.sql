-- Remove the voice agent and WhatsApp agent from the database (28 October 2026).
-- Their code was deleted; the website chat assistant is the only AI channel.
-- Orders, payments, products and product knowledge are kept.
--
-- The deleted 20260904000000_whatsapp_agent_integration.sql also made two
-- changes that are still needed; they are restated here so a fresh database
-- ends in the same state.

BEGIN;

-- ── Still-needed parts of the removed WhatsApp integration migration ───────────
ALTER TABLE public."Payments" ADD COLUMN IF NOT EXISTS payment_context JSONB NOT NULL DEFAULT '{}';

-- Knowledge editing is an admin operation. Browser writes must go through the
-- verified admin path, never the public anon key.
DROP POLICY IF EXISTS "Admin write product_knowledge" ON public.product_knowledge;
DROP POLICY IF EXISTS "Admin update product_knowledge" ON public.product_knowledge;
DROP POLICY IF EXISTS "Admin delete product_knowledge" ON public.product_knowledge;
REVOKE INSERT, UPDATE, DELETE ON public.product_knowledge FROM anon, authenticated;

-- product_knowledge keeps its updated_at trigger on the generic function.
DROP TRIGGER IF EXISTS update_product_knowledge_modtime ON public.product_knowledge;
CREATE TRIGGER update_product_knowledge_modtime BEFORE UPDATE ON public.product_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Voice and WhatsApp tables (children first) ─────────────────────────────────
DROP TABLE IF EXISTS public.whatsapp_sessions;
DROP TABLE IF EXISTS public.whatsapp_message_events;
DROP TABLE IF EXISTS public.whatsapp_agent_sessions;
DROP TABLE IF EXISTS public.whatsapp_agent_locks;
DROP TABLE IF EXISTS public.voice_checkout_items;
DROP TABLE IF EXISTS public.voice_checkout_sessions;
DROP TABLE IF EXISTS public.voice_call_sessions;

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

COMMENT ON COLUMN public.orders.tracking_sent_at IS
  'When the tracking URL was last sent to the customer.';

COMMIT;
