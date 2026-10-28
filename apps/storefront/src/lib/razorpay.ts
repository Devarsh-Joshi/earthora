// src/lib/razorpay.ts
// Frontend helper — opens the Razorpay Magic Checkout (1-click) modal.
// KEY_SECRET is NEVER used here. Only the public KEY_ID is referenced.

let _rzpScriptPromise: Promise<void> | null = null;

/** Load the dedicated Magic Checkout SDK once. Standard checkout.js does not enable 1CC. */
export function loadRazorpayScript(): Promise<void> {
  if (document.querySelector('script[data-earthora-magic-checkout="loaded"]') && window.Razorpay) return Promise.resolve();
  if (_rzpScriptPromise) return _rzpScriptPromise;
  _rzpScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/magic-checkout.js';
    s.async = true;
    s.onload = () => {
      if (!window.Razorpay) { _rzpScriptPromise = null; reject(new Error('Magic Checkout SDK did not initialize.')); return; }
      s.dataset.earthoraMagicCheckout = 'loaded';
      resolve();
    };
    s.onerror = () => { s.remove(); _rzpScriptPromise = null; reject(new Error('Magic Checkout SDK failed to load.')); };
    document.head.appendChild(s);
  });
  return _rzpScriptPromise;
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (response: RazorpayFailureResponse) => void) => void;
}

export interface RazorpayShippingAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country?: string;
  zipcode?: string;
  type?: string;
}

export interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
  // Magic Checkout may echo these fields directly in the handler payload
  contact?: string;
  email?: string;
  shipping_address?: RazorpayShippingAddress;
  billing_address?: RazorpayShippingAddress;
}

export interface RazorpayFailureResponse {
  error: {
    code: string;
    description: string;
    source: string;
    step: string;
    reason: string;
    metadata: { payment_id?: string; order_id?: string };
  };
}

export interface OpenRazorpayModalOptions {
  orderId: string;
  amount: number; // in paise
  currency: string;
  keyId: string;
  prefill?: { name?: string; email?: string; contact?: string };
  onSuccess: (response: RazorpaySuccessResponse) => void;
  onFailure: (reason: string) => void;
  onPaymentFailed?: (reason: string) => void;
  onDismiss?: () => void;
}

/**
 * Opens Magic Checkout; the modal collects the delivery address itself.
 */
export function openRazorpayModal({
  orderId,
  amount,
  currency,
  keyId,
  prefill,
  onSuccess,
  onFailure,
  onPaymentFailed,
  onDismiss,
}: OpenRazorpayModalOptions): void {
  if (!window.Razorpay) {
    onFailure('Razorpay SDK failed to load. Please refresh and try again.');
    return;
  }

  const activeKeyId = keyId || (import.meta.env.VITE_RAZORPAY_KEY_ID as string);
  if (!activeKeyId || !orderId?.startsWith('order_')) {
    onFailure('Secure checkout is not configured. Please try again later.');
    return;
  }

  const options: Record<string, unknown> = {
    key: activeKeyId,
    amount,
    currency: currency || 'INR',
    name: 'Earthora Farms',
    description: 'Organic Moringa Products',
    image: '/favicon.svg',
    prefill,
    order_id: orderId,
    one_click_checkout: true,
    // Promotions stay hidden until a promotion policy is enabled server-side.
    show_coupons: false,
    theme: {
      color: '#3d6b3f',
    },
    handler: (response: RazorpaySuccessResponse) => {
      onSuccess(response);
    },
    modal: {
      ondismiss: () => {
        if (onDismiss) onDismiss();
        else onFailure('Payment cancelled by user.');
      },
    },
  };

  const rzp = new window.Razorpay(options);

  rzp.on('payment.failed', (response: RazorpayFailureResponse) => {
    const msg = response?.error?.description || 'Payment failed. Please try again.';
    // Razorpay keeps the modal open for a retry. Do not settle the checkout
    // promise until the customer succeeds or dismisses the modal.
    onPaymentFailed?.(msg);
  });

  rzp.open();
}
