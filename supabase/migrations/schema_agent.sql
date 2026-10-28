-- ===========================================================================
-- EARTHORA FARMS — PRODUCT KNOWLEDGE & PAYMENT WEBHOOK SCHEMA (CONSOLIDATED)
-- File: schema_agent.sql
-- ---------------------------------------------------------------------------
-- Prerequisites: schema_website.sql must be applied first.
--   This schema references products and uses update_updated_at_column(),
--   both defined in schema_website.sql.
-- ---------------------------------------------------------------------------
-- Access model: payment_webhook_events is service-role only. product_knowledge
-- is readable by anon/authenticated; writes go through the verified admin path.
-- The former voice/WhatsApp agent tables were removed on 28 October 2026.
-- ===========================================================================

-- ── 1. PRODUCT KNOWLEDGE ─────────────────────────────────────────────────────
-- Admin-curated, versioned facts the chat assistant may answer from for
-- benefits/dosage/warnings/etc. Only approved + currently-effective rows are
-- ever used.
CREATE TABLE IF NOT EXISTS product_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL CHECK (category IN (
    'description', 'benefits', 'dosage', 'directions', 'ingredients',
    'warnings', 'contraindications', 'storage', 'faq'
  )),
  question TEXT,
  content TEXT NOT NULL,
  locale VARCHAR(10) NOT NULL DEFAULT 'en-IN',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_lookup
  ON product_knowledge(product_id, category, status);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_approved
  ON product_knowledge(product_id, category)
  WHERE status = 'approved';
DROP TRIGGER IF EXISTS update_product_knowledge_modtime ON product_knowledge;
CREATE TRIGGER update_product_knowledge_modtime BEFORE UPDATE ON product_knowledge
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. PAYMENT WEBHOOK EVENTS ────────────────────────────────────────────────
-- Durable idempotency inbox. Every inbound Razorpay webhook delivery is
-- recorded here BEFORE processing; a UNIQUE violation on provider_event_id
-- short-circuits duplicate/retried deliveries.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(20) NOT NULL DEFAULT 'razorpay',
  provider_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  payload JSONB NOT NULL,
  processing_status VARCHAR(20) NOT NULL DEFAULT 'received' CHECK (processing_status IN (
    'received', 'processed', 'failed', 'ignored'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_status
  ON payment_webhook_events(processing_status);

-- ===========================================================================
-- ROW LEVEL SECURITY
-- ===========================================================================
ALTER TABLE product_knowledge         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_events    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service manage product_knowledge" ON product_knowledge;
CREATE POLICY "Service manage product_knowledge" ON product_knowledge FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service manage payment_webhook_events" ON payment_webhook_events;
CREATE POLICY "Service manage payment_webhook_events" ON payment_webhook_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Scoped exception: the /sun-earthora admin portal reads product_knowledge.
DROP POLICY IF EXISTS "Admin read product_knowledge" ON product_knowledge;
CREATE POLICY "Admin read product_knowledge" ON product_knowledge FOR SELECT TO anon, authenticated USING (true);
-- Writes go through the verified admin path (service role), never the anon key.
DROP POLICY IF EXISTS "Admin write product_knowledge" ON product_knowledge;
DROP POLICY IF EXISTS "Admin update product_knowledge" ON product_knowledge;
DROP POLICY IF EXISTS "Admin delete product_knowledge" ON product_knowledge;

-- ===========================================================================
-- GRANTS
-- ===========================================================================
GRANT ALL ON product_knowledge, payment_webhook_events TO service_role;

-- product_knowledge: read-only browser access for the admin portal.
GRANT SELECT ON product_knowledge TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON product_knowledge FROM anon, authenticated;

-- RLS already denies anon/authenticated; this is defense-in-depth.
REVOKE ALL ON payment_webhook_events FROM anon, authenticated;
