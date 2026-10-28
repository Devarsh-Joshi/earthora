-- Low-stock alerts are created by the inventory deduction trigger and delivered
-- by the send-sms-alert Edge Function over SMS.
-- Configure a Supabase Database Webhook for INSERT on sms_alert_logs to call
-- the send-sms-alert function. The webhook is the asynchronous delivery step;
-- the inventory/order transaction itself remains fast and non-blocking.

CREATE OR REPLACE FUNCTION public.trigger_low_stock_sms()
RETURNS TRIGGER AS $$
DECLARE
  v_product_name TEXT;
  v_recipients TEXT[];
BEGIN
  IF NEW.total_stock <= NEW.low_stock_threshold
     AND (OLD.total_stock > NEW.low_stock_threshold
          OR OLD.total_stock IS NULL
          OR NEW.alert_sent_at IS NULL)
  THEN
    SELECT name INTO v_product_name FROM public.products WHERE id = NEW.product_id;
    v_recipients := ARRAY['7572866635'];
    INSERT INTO public.sms_alert_logs (
      triggered_by, product_id, product_name, stock_at_alert,
      threshold, recipients, status
    ) VALUES (
      'auto_trigger', NEW.product_id::text, COALESCE(v_product_name, 'Unknown Product'),
      NEW.total_stock, NEW.low_stock_threshold, v_recipients, 'pending'
    );
    NEW.alert_sent_at := NOW();
  END IF;

  -- A restock above the threshold arms the next alert cycle.
  IF NEW.total_stock > NEW.low_stock_threshold THEN
    NEW.alert_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_low_stock_sms_alert ON public.inventory;
CREATE TRIGGER trigger_low_stock_sms_alert
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.trigger_low_stock_sms();

-- If a product was already below the threshold before this migration was
-- deployed, touch that inventory row once so the trigger queues its alert
-- immediately instead of waiting for another stock edit/order.
UPDATE public.inventory
SET alert_sent_at = NOW()
WHERE total_stock <= low_stock_threshold
  AND alert_sent_at IS NULL;

