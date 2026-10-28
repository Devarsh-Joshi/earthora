# Earthora Magic Checkout

The storefront cart and AI order-review page use Razorpay Magic Checkout.

## Account and deployment setup

1. Ask the Razorpay SPOC to enable **Magic Checkout** for the Earthora account.
   The feature is account-gated; `one_click_checkout: true` alone cannot enable it.
2. Configure the API process with `RAZORPAY_KEY_ID` and
   `RAZORPAY_KEY_SECRET` from the same Razorpay mode/account. Only the key ID
   is returned to the browser. Set `RAZORPAY_WEBHOOK_SECRET` when configuring
   payment webhooks. Use test keys and settings for test mode, then repeat the
   settings with the correct live keys before going live.
3. In Razorpay Dashboard → Magic Checkout → Platform Setup, choose **Custom
   E-Commerce Platform**. Under Checkout Settings, enter these publicly
   accessible URLs (substitute the actual API host if it differs):

   - Get promotions: `https://earthorafarms.com/api/store/checkout/magic/promotions`
   - Apply promotions: `https://earthorafarms.com/api/store/checkout/magic/apply-promotion`
   - Shipping Setup → API → Shipping info:
     `https://earthorafarms.com/api/store/checkout/magic/shipping-info`

   The callback routes need no user authentication. They require the opaque,
   server-generated Razorpay order receipt, and return no customer data.
4. Leave **Cash on Delivery** disabled in the Razorpay account. The shipping
   callback offers only prepaid free delivery to six-digit Indian PIN codes.
   Coupon entry is hidden, and promotion callbacks return no promotions until
   an approved store coupon policy is implemented. Do not advertise coupons
   or enable COD in the dashboard without implementing their order-accounting
   and fulfillment paths first.
5. Configure a Razorpay webhook for the `payment.captured` event at
   `https://earthorafarms.com/api/store/checkout/magic/webhook`, using the
   same `RAZORPAY_WEBHOOK_SECRET` as the API process. It recovers a paid order
   if the browser closes, and retries are idempotent. A checkout result is
   finalized only after server-side signature verification and a fetched
   `captured` INR payment tied to a `paid` Razorpay order for the server-priced
   amount. An `authorized` payment, COD placement, or callback query string is
   not treated as a completed prepaid order.

## Local checks

`npm run typecheck`, `npm run test -w @earthora/api`, and `npm run build`.
For a provider acceptance check, use a test-mode account with Magic Checkout
enabled and confirm the modal collects an address, calls shipping info, returns
a captured payment, creates exactly one website order, and queues its invoice.
Do not run a live charge merely to test this integration.
