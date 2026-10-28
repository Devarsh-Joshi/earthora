-- Admin-managed shipment tracking details and delivery audit state.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS tracking_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.tracking_url IS
  'The courier tracking URL entered by an authorized admin.';
COMMENT ON COLUMN public.orders.tracking_sent_at IS
  'When the tracking URL was last sent to the customer.';
