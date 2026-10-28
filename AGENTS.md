# Earthora Project Instructions

These instructions apply to the entire repository. Also read `CLAUDE.md` and the
area-specific README before changing that area.

## Owner working agreement

The owner works quickly and expects autonomous, end-to-end execution. A task is
complete only when the requested result is implemented, configured, exercised,
and verified in the intended environment.

- Own the whole workflow: inspect, implement, install, configure, run, diagnose,
  fix, retry, deploy, and verify when those steps are within the request.
- Do not stop at a plan, partial patch, rehearsal result, or list of steps for the
  owner. Exhaust reasonable in-scope paths yourself.
- Read the repository, reference documents, deployment configuration, and current
  environment before asking a question. Choose sensible defaults when they do not
  materially change the requested outcome.
- Do not repeatedly ask for confirmation already supplied by the owner's request.
  Ask only when an essential missing choice would materially change the result.
- If one item is genuinely blocked, finish every independent part first. Report
  the blocker concisely with the exact attempts already made.
- Keep progress and final reports concise. The final report should state what was
  completed, where it was deployed or run, what was verified, and any real open
  blocker.

## Credentials and authenticated work

- Credentials, tokens, API keys, account identifiers, and other secrets supplied
  by the owner are authorization to use them for the stated task.
- Put supplied secrets in the appropriate ignored local environment file,
  deployment secret field, CLI input, SDK, or API request needed to complete the
  work. Do not turn their use into a separate approval step.
- Do not echo secrets into chat, command output, screenshots, source control, or
  unrelated files. Never commit live secrets.
- Do not add unsolicited credential-handling lectures, rotation advice, or generic
  security disclaimers. Mention credential handling only when it is the actual
  blocker or the user asks for a security review.

## Compulsory live limited trials

- When the owner requests a limited live trial and gives its scope or amount, the
  live trial is a required acceptance step. Run it in the same workflow; do not
  silently replace it with a mock, sandbox, rehearsal, or dry run.
- The request for that exact limited live action is the approval. Do not ask for a
  second confirmation merely because it uses a production provider or incurs the
  specified small charge.
- Use mocks and automated tests as preparation, not as substitutes for the
  requested live check. Confirm the externally observable result after the live
  action, including provider state, callback/webhook processing, database state,
  and customer-facing output as applicable.
- Keep live effects strictly inside the owner's stated amount, account, recipient,
  and scope. Do not broaden a live trial on your own.
- Higher-priority platform rules still apply. If one prevents a particular action,
  complete all remaining work and state that single concrete limitation without a
  general lecture.

## Project map

The voice agent (web/phone) and the WhatsApp agent were removed on 28 October
2026. The website chat assistant is the only AI channel; do not restore the old
voice-service, whatsapp-chatbot or livekit-voice code without an explicit request.

- `apps/storefront/`: React 19, TypeScript, Vite, Tailwind storefront and the
  developer, SUN/Earthora, and KACC admin surfaces.
- `apps/api/`: Fastify/TypeScript business API and worker. It owns the catalogue,
  pricing, Razorpay Magic Checkout, invoices, notifications and the website chat
  assistant platform (`src/platform`), including chat checkout-review links.
- `apps/console/`: AI administration console for the chat assistant.
- `supabase/`: website schemas, incremental migrations, and Edge Functions for
  OTP, admin verification, product knowledge, invoices, uploads, and stock/SMS
  alerts.
- `netlify/functions/`: storefront server functions for Razorpay order creation
  and verification, and invoices.
- `tests/`: cross-stack schema tests for the Supabase knowledge-admin function.
- `C:\Earthora\Docs`: lease, PKM-2 crop-management guide, and Gujarati farm-worker
  operating plan. Consult these when a task touches facilities or farm operations.

## Important system invariants

- Supabase is the shared production data source. Server-only keys must never use a
  `VITE_` prefix or enter the browser bundle.
- The chat assistant must use current products, stock, pricing and approved
  product knowledge; do not hard-code a second catalogue.
- The editable review form is the customer confirmation boundary. Only verified
  payment/finalization paths may write real orders and payments, and webhook
  retries must remain idempotent.
- Keep pricing logic in `apps/api/src/modules/commerce/pricing.ts` aligned with the
  storefront implementation and `apps/api/src/modules/commerce/pricing-cases.json`.

## Verification expectations

Run the checks relevant to the changed surface and fix failures caused by the
work. Do not claim success from code inspection alone.

- Storefront, API and console: `npm run typecheck`, `npm run test`,
  `npm run test:schema`, and `npm run build`.
- Production API checks start with `/healthz`, but that does not prove external
  credentials, messaging, or payments work. When the task requires production
  confidence, complete the requested live limited trial and verify its full
  external path.
- For database changes, apply migrations in dependency order and verify the real
  affected query/RPC/Edge Function path in addition to local schema tests.

## Reference material

- `output/earthora-ai-platform-master-plan.md`: consolidated target architecture,
  migration sequence, and acceptance gates. This is a planning baseline, not a
  statement that production has already migrated; current invariants apply until
  the corresponding verified cutover.
- `CLAUDE.md`: owner operating rules shared with other coding agents.
- `design.md`: brand tokens, typography, interaction conventions, and page layout.
