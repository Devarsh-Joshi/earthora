// Deno Edge Function — Tata SmartFlow SMS sender
// Handles two cases:
//   triggered_by = "auto_trigger"    → low-stock alert to admin phones
//   triggered_by = "restock_trigger" → back-in-stock SMS to waiting customers

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
};

const SMARTFLOW_API_KEY    = Deno.env.get("SMARTFLOW_API_KEY")!;
const SMARTFLOW_SENDER_ID  = Deno.env.get("SMARTFLOW_SENDER_ID")!;
const SMARTFLOW_BASE_URL   = Deno.env.get("SMARTFLOW_BASE_URL")!;
// e.g. https://smartflow.tatacommunications.com/api/v1
// (get exact URL from Tata SmartFlow dashboard → API Credentials)

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---------------------------------------------------------------------------
// SmartFlow send helper
// ---------------------------------------------------------------------------
async function sendSmartFlowSms(phone: string, message: string): Promise<any> {
  const normalised = phone.startsWith("+") ? phone : `+91${phone}`;
  const response = await fetch(`${SMARTFLOW_BASE_URL}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SMARTFLOW_API_KEY}`,
    },
    body: JSON.stringify({
      from: SMARTFLOW_SENDER_ID,
      to:   normalised,
      message,
      type: "text",
    }),
  });
  return response.json();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
// @ts-ignore
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const payload = await req.json();
    const record  = payload.record; // the new sms_alert_logs row

    if (!record || !record.recipients || record.recipients.length === 0) {
      return new Response("No recipients", { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // -----------------------------------------------------------------------
    // CASE 1 — Admin low-stock alert  (triggered_by = "auto_trigger")
    // -----------------------------------------------------------------------
    if (record.triggered_by === "auto_trigger") {
      const smsConfigured = Boolean(SMARTFLOW_API_KEY && SMARTFLOW_SENDER_ID && SMARTFLOW_BASE_URL);
      // Returning 503 when SMS is not configured lets a configured Supabase
      // webhook retry instead of swallowing the alert as a permanent failure.
      if (!smsConfigured) {
        return new Response(JSON.stringify({ success: false, error: "no_alert_delivery_provider_configured" }), { status: 503 });
      }

      // Claim the row atomically so a retried webhook can never deliver the
      // same alert twice.
      const { data: claimed, error: claimError } = await supabase
        .from("sms_alert_logs")
        .update({ status: "processing" })
        .eq("id", record.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) return new Response(JSON.stringify({ success: true, duplicate: true }), { status: 200 });

      const message =
        `⚠️ Low Stock Alert — Earthora Farms\n` +
        `Product: ${record.product_name}\n` +
        `Current Stock: ${record.stock_at_alert} units\n` +
        `Threshold: ${record.threshold} units\n` +
        `Please arrange restocking soon.\n` +
        `Admin: https://www.earthorafarms.com/sun-earthora/products`;

      const deliveries: Promise<any>[] = record.recipients.map((phone: string) => sendSmartFlowSms(phone, message));

      const results = await Promise.allSettled(deliveries);
      const succeeded = results.filter(r => r.status === "fulfilled").length;
      const deliveryStatus = succeeded === 0 ? "failed" : succeeded === results.length ? "delivered" : "partial";
      const firstSuccess = results.find((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled");

      await supabase
        .from("sms_alert_logs")
        .update({
          status: deliveryStatus,
          provider_message_id: firstSuccess?.value?.message_id ?? null,
        })
        .eq("id", record.id);
    }

    // -----------------------------------------------------------------------
    // CASE 2 — Customer restock notification  (triggered_by = "restock_trigger")
    // -----------------------------------------------------------------------
    if (record.triggered_by === "restock_trigger") {
      const message =
        `✅ Good news from Earthora Farms!\n` +
        `${record.product_name} is back in stock.\n` +
        `Order now: https://www.earthorafarms.com/our-product\n` +
        `Reply STOP to unsubscribe.`;

      const results = await Promise.allSettled(
        record.recipients.map(async (phone: string) => {
          const smsResult = await sendSmartFlowSms(phone, message);

          // Mark this customer's request as sent
          await supabase
            .from("customer_restock_requests")
            .update({
              status:      "sent",
              notified_at: new Date().toISOString(),
            })
            .eq("product_id", record.product_id)
            .eq("customer_phone", phone);

          return smsResult;
        })
      );

      const allSucceeded = results.every(r => r.status === "fulfilled");

      await supabase
        .from("sms_alert_logs")
        .update({ status: allSucceeded ? "delivered" : "failed" })
        .eq("id", record.id);
    }

    return new Response(JSON.stringify({ success: true }), {
      status:  200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("SmartFlow SMS error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
