import { useCallback, useEffect, useState } from "react";
import { useCart } from "@/contexts/cart-context";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/apiClient";
import { loadRazorpayScript, openRazorpayModal } from "@/lib/razorpay";
import type { RazorpaySuccessResponse } from "@/lib/razorpay";
import type { CartItem } from "@/types";

const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID as string;

export interface CheckoutResult {
  orderNumber: string;
  total: number;
}
export interface CheckoutCustomer { name: string; email: string; phone: string; address: string; city: string; state: string; zip: string; country: string }

/**
 * Razorpay 1-click checkout.
 * - The server prices the cart and creates the Razorpay order (client amounts are never trusted).
 * - After payment, the server verifies the signature, pulls the collected address from Razorpay and
 *   finalizes the order in one transaction (invoice + admin notification are queued there).
 */
export function useCheckout() {
  const { clearCart } = useCart();
  const { toast } = useToast();
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => { loadRazorpayScript().catch(() => {}); }, []);

  const runCheckout = useCallback(
    async (items: CartItem[], customer?: CheckoutCustomer): Promise<CheckoutResult | null> => {
      if (items.length === 0 || isPaying) return null;
      setIsPaying(true);
      try {
        await loadRazorpayScript();
        const orderData = await api<{ order_id: string; amount: number; currency: string; key_id: string }>("/api/store/checkout/order", {
          method: "POST",
          json: { cartItems: items.map((i) => ({ productId: i.id, quantity: i.quantity })), currency: "INR", ...(customer ? { customer } : {}) },
        });

        const result = await new Promise<CheckoutResult>((resolve, reject) => {
          openRazorpayModal({
            orderId: orderData.order_id,
            amount: orderData.amount,
            currency: "INR",
            keyId: orderData.key_id || RAZORPAY_KEY_ID,
            prefill: customer ? {name: customer.name, email: customer.email, contact: customer.phone} : undefined,
            onDismiss: () => reject(new Error("Payment cancelled by user.")),
            onFailure: (reason) => reject(new Error(reason || "Payment failed.")),
            onPaymentFailed: (reason) => toast({ title: "Payment not completed", description: `${reason} You can retry in the secure checkout.`, variant: "destructive" }),
            onSuccess: async (response: RazorpaySuccessResponse) => {
              try {
                let verified: { success: boolean; orderId: string; orderNumber: string; amount: number } | undefined;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    verified = await api<typeof verified>("/api/store/checkout/verify", {
                      method: "POST",
                      json: {
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature,
                      },
                    });
                    break;
                  } catch (error) {
                    if (attempt === 2) throw error;
                    await new Promise((done) => setTimeout(done, 1500));
                  }
                }
                if (!verified?.success) throw new Error("Payment verification failed. Contact support.");
                clearCart();
                toast({ title: "Payment successful!", description: `Order ID: ${verified.orderNumber}` });
                resolve({ orderNumber: verified.orderNumber, total: verified.amount / 100 });
              } catch (err) {
                reject(new Error(`Payment ${response.razorpay_payment_id} was submitted, but we could not confirm your order yet. Please do not pay again; contact Earthora support with this payment ID.`));
              }
            },
          });
        });
        return result;
      } catch (err: any) {
        const msg = err?.message || "An unexpected error occurred.";
        if (!msg.toLowerCase().includes("cancel")) {
          toast({ title: "Payment error", description: msg, variant: "destructive" });
        }
        return null;
      } finally {
        setIsPaying(false);
      }
    },
    [isPaying, clearCart, toast]
  );

  return { runCheckout, isPaying };
}
