# Earthora voice and WhatsApp: reverse-engineered implementation specification

**Audit basis:** repository source and migrations inspected on 23 September 2026. This is a build-and-operations specification for reproducing the current behaviour, rather than a product brief. It deliberately distinguishes the active voice runtime from preserved legacy code so a future implementation does not accidentally revive an obsolete architecture.

## 1. The systems that exist today

Earthora has three adjacent, but different, conversational implementations:

| Surface | Current role | Primary code | Do not confuse it with |
| --- | --- | --- | --- |
| Browser and phone voice | **Active production voice path**. A self-hosted LiveKit agent, local GPU STT/TTS, Qwen native function calling, and the current Earthora API/data boundary. | `livekit-voice/`, `apps/api/src/platform/channels/sunpath.ts` | `voice-service/`'s Render voice sockets and old full-turn LLM loop |
| WhatsApp | Durable asynchronous channel that persists state and reuses the legacy commerce conversation engine. | `whatsapp-chatbot/`, `voice-service/src/conversation/`, `voice-service/src/tools/` | A direct LiveKit participant or a stateless provider webhook |
| Legacy Node voice service | Still contains the shared cart, checkout, payment, invoice, and WhatsApp-compatible conversation logic. It is a useful business-rule reference, **not** the active media stack. | `voice-service/` | The active LiveKit/SunPath worker |

The architectural rule is: **the model never owns business truth or writes orders directly**. Current catalogue, approved knowledge, cart, checkout validation, payment finalization, and durable transport state stay in Earthora-controlled services and Postgres/Supabase.

## 2. End-to-end topology

```text
Browser microphone ─┐
                    ├─ LiveKit room ─ named earthora-sunpath agent ─ VAD/STT ─ Qwen
Smartflo G.711 WS ──┘                                      │             │
                                                           │             └─ guarded text ─ Neha TTS
                                                           │
                                      authenticated internal Earthora API
                                                           │
                   catalogue / approved product knowledge / cart / checkout / requests

Meta or Tata Omni callback → HMAC/secret validation → durable inbox → ordered worker
    → shared commerce turn processor → atomic state + reply save → provider delivery
    → review form → verified Razorpay webhook → database finalizer → order/invoice
```

The public LiveKit signalling endpoint and the Smartflo bridge terminate through Nginx/TLS on the Earthora VPS. The SFU, control service, and agent are private/loopback-facing. A browser receives only a scoped, short-lived room token; the voice internal key, LiveKit signing secret, database service credentials, and GPU key are server-only.

## 3. Active LiveKit voice system

### 3.1 Admission, identity, and room lifecycle

`livekit-voice/server/earthora_control.py` creates rooms and issues twenty-minute caller join tokens. Browser session admission starts at the API route consumed by `livekit-voice/browser/transport.ts`; phone admission is performed by the Smartflo bridge against the internal session endpoint. Both result in a room explicitly dispatched to the named `earthora-sunpath` agent—there is no wildcard or automatic worker join.

The agent (`earthora_agent.py`) prewarms Silero VAD and applies a hard two-session operational model. Its admission logic reserves pending jobs briefly so concurrent dispatcher requests cannot oversubscribe the configured cap. A room has an empty timeout/departure timeout and an explicit caller identity derived from validated room metadata. Room names, channel keys, session IDs, and internal payload sizes are bounded and validated.

Session safety controls:

- Maximum default conversation turns: 50 (`VOICE_MAX_TURNS_PER_SESSION`).
- Absolute default session cap: 900 seconds (`MAX_SESSION_SECONDS`).
- Browser idle warning/close timing differs from phone; a muted browser does not receive an erroneous away close.
- Farewell, turn-cap, session-cap, repeated-failure, silence, and normal provider closure each produce an explicit `call_end` reason.
- Terminal speech is allowed to finish before closing unless interrupted. This prevents a farewell from being cut off.
- Three consecutive context/generation/pipeline failures close the session rather than recursively retrying forever.

The browser-facing session endpoint is `POST /platform/voice/livekit/session` (`apps/api/src/platform/channels/livekit.ts`). It validates channel key/conversation ID/language, requires an enabled voice channel, creates or loads the namespaced conversation, and asks the control service to create a room. The control request has a fifteen-second deadline and carries constrained metadata only: session ID, public channel key, channel (`web`/`phone`), and language. Phone admission is internal-only, derives a stable external ID by hashing the provider call ID, and is restricted to the configured phone channel key. The control response must pass a strict token/URL/room-name schema before it reaches a browser.

There is also a retained `/platform/voice/internal/turn` bridge for an older platform-engine path. It authenticates internal callers, serializes/deduplicates by tenant/channel/session/turn ID, persists the user turn, runs the platform engine under tenant voice scope, persists tool-aware assistant history and state, and returns text only after grounding and durable writes. The current SunPath agent instead uses the more granular `context` / `tool` / `record` endpoints described below; do not accidentally wire both turn loops into one room.

### 3.2 Media pipeline

1. **Browser:** the client starts audio within the user gesture, requests a LiveKit room, connects with echo cancellation/noise suppression/automatic gain control, enables the microphone, attaches remote audio, and reports an audio meter every 60 ms. It handles reconnect, disconnect cleanup, mute state, and autoplay-blocked events.
2. **Phone:** `/ws/voice/smartflo` accepts only bounded JSON frames. It requires 8 kHz mu-law in a valid `start` event, decodes/resamples to mono 16 kHz PCM for LiveKit, and turns agent PCM back into paced 8 kHz mu-law 160-byte frames. It ignores provider outbound media, checks stream IDs, limits payloads, and deletes the LiveKit room during cleanup.
3. **STT:** `PlymaxxSTT` accepts completed utterances (not interim streaming text), limits an utterance to 30 seconds, downmixes/resamples, and detects digital silence without rejecting softly spoken digits. Whisper Turbo performs automatic language recognition. Gujarati can be re-decoded from the *same original audio* with IndicConformer when enabled or when supported-language recovery requires it. Unsupported recognition triggers one recoverable clarification per speech epoch instead of terminating the voice pipeline.
4. **Turn detection/interruption:** LiveKit’s multilingual turn detector plus VAD ends a turn. Because STT is completed-utterance, the interruption guard defaults to zero words and 0.5 seconds of VAD. On actual SDK interruption (not merely VAD onset), the agent invalidates any review confirmation and emits `agent_interrupted`; phone delivery sends `clear`, discards pending audio, and advances an audio epoch.
5. **LLM:** Qwen `qwen3.5:9b` runs through an OpenAI-compatible GPU endpoint with thinking disabled and a 256-token cap. The LiveKit OpenAI plugin is a protocol adapter only; it is not an OpenAI inference dependency. The LLM gets native, schema-checked tools directly in the session.
6. **TTS:** `PlymaxxTTS` uses Indic Parler, voice `Neha`, for English, Hindi/Hinglish, and Gujarati. It returns completed 44.1 kHz mono PCM16 WAV phrases. The first phrase is capped at 200 characters and following phrases at 400. `VOICE_TTS_SPEED` accepts 1.0–1.4; values other than 1 use cancellable pitch-preserving FFmpeg tempo. A malformed waveform gets only one in-budget retry. There is no paid STT/TTS/LLM fallback.

This is continuous, interruptible transport built from completed STT/TTS operations; it must not be marketed as native zero-latency streaming inference.

### 3.3 Voice data events and browser navigation

All room data uses reliable topic `earthora.voice`. The browser accepts only agent-originated packets no larger than 32 KiB. It receives transcript/reply/state/error/call-end events and supplies `client_voice_state` after agent join, mute changes, and reconnects.

The browser loads a bounded site guide from `/api/platform/voice/site-guide` with a four-second timeout. The agent can request:

- `navigate_site`: an allowlisted route/anchor/product destination only. The client performs navigation and returns a result before the agent claims that it opened.
- `scroll_page`: one of the allowlisted scroll directions, web only.
- `cancel_navigation`: cancels a pending client navigation when the caller barges in.
- `request_voice_state`: asks the client whether its microphone is muted.

Automatic guided navigation can be disabled by an explicit “stay on this page / do not navigate” request. The concierge logic never auto-routes checkout, account, payment credentials, individual order status, request form data, or dosage questions to a public page.

### 3.4 The API boundary and idempotency

`apps/api/src/platform/channels/sunpath.ts` is the active trust boundary. The agent only calls authenticated internal endpoints with a timing-safe Bearer-key comparison:

- `POST /platform/voice/internal/context`: returns persona, current language, last eight persisted messages, live catalogue, approved knowledge, cart/checkout state, exact native tool schemas, site guide, and request drafts.
- `POST /platform/voice/internal/tool`: validates identity, tool name, schema, argument size, and current channel before invoking an allowlisted function.
- `POST /platform/voice/internal/record`: stores bounded user/assistant transcripts with a stable message ID and language.
- `POST /platform/voice/internal/flow-request`: accepts validated Studio request data.
- `GET /platform/voice/checkout/*`: exposes a no-store, referrer-free checkout snapshot view; it does not create an order.

`VoiceTurnQueue` serializes operations per channel/session and caches both success and failure by turn/call ID and content fingerprint for fifteen minutes. A reused ID with different content is a conflict; a retry of a mutation after a lost response gets the original result rather than repeating a cart, callback, or checkout side effect.

### 3.5 Native tools: full allowlist

The agent receives exactly these application capabilities—not database access, arbitrary HTTP, arbitrary functions, or arbitrary URLs.

| Tool | Behaviour and guard |
| --- | --- |
| `list_products` | Current catalogue with live price and stock state. |
| `get_product_details` | Exact current active product ID; native voice rejects legacy fuzzy/fallback product resolution. |
| `search_knowledge` | Approved canonical product knowledge plus public indexed passages; query must use concise English semantic keywords even when the caller speaks Hindi/Gujarati. |
| `add_to_cart` | Exact active product ID and quantity; API state is saved and web gets a cart-sync browser action. |
| `update_cart` | Exact active product ID; zero removes. |
| `get_cart` | Current server-priced cart. |
| `set_customer_detail` | Bounded validated delivery field only; never payment secrets. |
| `create_checkout_link` | Requires nonempty cart and valid complete customer data; creates only a short-lived editable review snapshot, never an order. |
| `get_order_status` | Requires an order number plus matching phone or email. |
| `capture_callback` | Intentionally rejected on current voice; the reviewed request flow is required. |
| `navigate_site`, `scroll_page` | Web-only, site-guide constrained, client-acknowledged screen actions. |
| `start_request` | Starts/resumes a `contact` or `callback` draft. |
| `set_request_field` | Saves one validated request field at a time. |
| `review_request` | Returns an exact verbal review plus a confirmation token. |
| `submit_request` | Requires a fresh review token and explicit confirmation; stale/interrupted/revised reviews are blocked. |

Tool calls are bound to the current speech epoch. An interruption makes older calls fail rather than act on stale caller intent. Tool errors are converted to a safe prompt to clarify; mutations are not automatically retried. Result payloads are bounded before returning to Qwen.

### 3.6 Knowledge system: the part that must be reproduced exactly

The knowledge system is not generic RAG. It is a layered, versioned evidence contract:

1. The context load finds current live catalogue IDs.
2. `approvedVoiceProductKnowledge()` selects **every** approved, effective product record belonging to an active catalogue product for the Earthora tenant. It retains product/category/question/locale/version/status/approval/effective-date provenance. Conflicting approved records are intentionally visible; they are not silently picked or merged.
3. `indexedVoiceKnowledge()` selects only Earthora-tenant, public, indexed, effective document chunks, ordered by authority and capped at 20. Search retrieval ranks at most six chunks; their order is preserved for search results.
4. `searchVoiceKnowledge()` returns complete canonical records first plus ranked public passages. Canonical records are not truncated or rewritten at the API boundary.
5. `sunpath_runtime.py` detects the topic (ingredients, benefits, usage/dosage, safety, policies, dispatch, price/availability, etc.), focuses product matches, selects only eligible/relevant evidence, and retains provenance through prompt construction.
6. A missing product fact causes deterministic retrieval before generation. A missing, ambiguous, or conflicting source produces a localized abstention—not a plausible answer. Known conflicting directions remain unresolved until an owner fixes the source.
7. The final answer guard checks knowledge-derived claims, exact amounts/ingredient strengths, current-price/stock claims, medical-outcome claims, and payment-secret requests. It replaces unsafe text before it reaches TTS.

Consequences for a future clone:

- Do not embed product truth in prompts or hard-code SKU facts.
- Do not let retrieved facts from a prior turn authorize a new factual claim.
- Preserve effective dates, approval status, versions, source ID, product/category/question context, and contradictory records.
- Keep product record evidence distinct from generic public document passages; canonical product records take precedence for the same product/attribute.
- Treat “not enough approved information” and “the approved records conflict” as successful safety outcomes.

### 3.7 Prompt, language, and output policy

The agent uses a deterministic greeting and deterministic simple language/policy replies where inference is unnecessary. Otherwise it builds a context containing at most five complete user/tool message groups, current authoritative cart/catalogue/tool chain, selected knowledge, and a bounded prompt budget of 7,600 estimated tokens. It never slices a function result away from the matching function call.

English, Hindi, Gujarati, and conversational Hinglish are supported. Language is detected each utterance, but the current-turn language instruction survives history truncation. STT hints are updated after every turn; TTS is updated to the same language. Tiny Hindi grammar corrections are deliberately narrow and run only after generation, before the final safety validator.

Spoken response rules are enforced in runtime, not merely suggested to the model:

- brief, natural, customer-focused spoken replies; normal replies are bounded, with a longer exact read-back allowance for a request review;
- no markdown/emoji before speech; price/stock/availability must come from current-turn live data;
- general Moringa/company facts may be supplied by approved context, but product-specific benefits, dosage, ingredients, warnings, price, and stock require current evidence;
- no diagnosis, prescription, cure/treatment claim, guaranteed outcome, or invented dispatch schedule;
- no request for/repetition of OTP, CVV, UPI PIN, card/bank passwords, or other payment credentials;
- purchase intent asks for a quantity rather than turning into consumption advice;
- an unknown named product is clarified instead of mapped to a plausible item;
- a reply is fully collected and validated before the first text reaches TTS. Tool-stream fragments cannot bypass the guard.

### 3.8 Concierge and enquiry collection

The September concierge layer handles low-risk unambiguous intent before Qwen: explicit requests to open an allowed page, a language-only switch, non-product policy answers, and structured contact/callback collection. It asks one missing field at a time and extracts/revalidates name, phone, email, and message/reason without inventing values.

Contact requires name/email/message, with optional phone/topic/marketing consent. Callback requires name/phone/reason. The complete review is read back, then a new explicit confirmation authorizes submission. Any correction, intervening question, screen interruption, or stale review invalidates the token. The model cannot claim submission before the server tool succeeds.

The request API is transactionally safe across processes: it locks the conversation, stores drafts with a revision, hashes the 48-hex review token rather than retaining it, binds a review to the latest user-message sequence, expires the review in ten minutes, and requires a new explicit confirmation after that sequence. On success it writes either `Contact_details` or an escalation, marks the conversation for follow-up where appropriate, and creates a deduplicated notification job. “Queued” is deliberately not described as human delivery.

The related Studio entry point accepts a bounded, typed external form payload with stable request ID/fingerprint, tenant+conversation lock, advisory lock across replayed IDs, input/HTML/URL validation, a validate-only rollback mode, mapping of approved contact/callback fields, and deduplicated outbox job creation. Studio cannot invent marketing consent from an arbitrary custom form field.

## 4. WhatsApp system

### 4.1 Provider ingestion and authentication

`whatsapp-chatbot/routes.ts` supports Meta Cloud and Tata Omni. Meta verification is the normal `hub.*` challenge plus raw-byte `x-hub-signature-256` HMAC. Tata uses a timing-safe shared secret from header, unguessable path token, or query token because its provider UI may not reliably preserve headers/query strings. Request logging is disabled for the webhook path.

The handler preserves raw bytes until authentication passes, parses JSON only afterwards, normalizes provider-specific shapes, inserts events into the durable inbox, wakes the worker, and immediately acknowledges. It never runs LLM/cart/payment work inline with a provider callback. Callback diagnostics intentionally retain only structural shape, boolean configuration/match state, and sizes—not tokens, URLs, messages, or customer identifiers.

Inbound normalization (`inbound.ts`) handles:

- Meta text, interactive button/list replies in snake_case and camelCase, legacy button payloads, and button titles;
- Tata flat/enveloped `payload`/`data`, singleton or array messages, multiple phone/message-ID field variants, text/content/payload variants, and interactive IDs;
- Indian local/leading-zero phone forms normalized to E.164, then general valid E.164 lengths;
- product/card action IDs converted to an internal action string before the conversation engine; unsupported attachments become a safe request to type the question.

### 4.2 Durable inbox, ordering, retry, and exactly-once turn effects

`whatsapp_message_events` is the durable inbox. `provider_message_id` is unique, so provider webhook retries dedupe before conversation processing. Its queue row contains input, outbound reply/media state, processing state, attempt count, scheduled retry time, bounded error, and audit timestamps.

`claim_next_whatsapp_message()` uses `FOR UPDATE SKIP LOCKED`, five maximum attempts, a stale-processing recovery window, and an anti-join that blocks a later message from the same phone while an earlier retryable one remains unresolved. Therefore multiple worker instances may drain the global queue without processing one event twice or reordering a person’s conversation.

The worker polls every 750 ms and drains up to ten events per pass. It also responds immediately to an in-process wake. Failure backoff is exponential from 5 seconds, capped at 300 seconds. Provider errors record status/body in bounded internal diagnostics; logs use a hash prefix of the phone rather than the phone itself.

The crucial failure-safe sequence is:

1. Claim an event.
2. Load/create that phone’s session; initialise the checkout phone from the sender number.
3. Run the turn exactly once.
4. Use `complete_whatsapp_message_turn_v2` to atomically persist conversation state, extend the 24-hour session, mark the reply as ready, and persist optional media/card payloads plus any flow timeout.
5. Deliver text/card/image.
6. Mark media sent, then mark the event processed.

If delivery fails after step 4, a retry sees `reply_text` and only resends the persisted outbound payload. It does **not** rerun the LLM or reapply a cart mutation. Product cards are serialized into the event payload so they can be resent faithfully.

### 4.3 Session and timeout model

`whatsapp_sessions` maps each E.164 number to a `voice_call_sessions` row, which holds the shared `ConversationState` and gives checkout rows a valid foreign-key chain. Sessions expire after 24 hours of inactivity; the next inbound message creates a fresh state. Persisted history is sanitized so orphaned/malformed tool messages can never reach a model as a valid tool transcript.

Quantity, checkout, and cart-removal are explicit subflows. Saving a turn schedules a five-minute flow timeout if one is active. `claim_expired_whatsapp_flow_timeout()` leases those timeout messages; the worker sends a localized timeout/resume notice and marks delivery using the same durable mechanics. The endpoint `/whatsapp/timeout-tick` exists for an authenticated external scheduler, in addition to normal worker draining.

### 4.4 Deterministic customer interaction paths

The WhatsApp controller prioritizes deterministic flows before model inference. This is important: a raw `1` can be a menu selection, product selection, quantity, PIN, cart item index, or active checkout answer depending on explicit prior state, not merely a regex.

| Flow | Exact behaviour |
| --- | --- |
| Greeting/menu | Broad English/Hindi/Gujarati greeting recognition and explicit menu request return Products, Benefits, Policies, Contact/Support. Active quantity/address/payment collection is not reset by a casual greeting. |
| Products | Fetches current catalogue on the turn, dynamically numbers products with current price/stock, then maps selection to an interactive current product card. Empty/retrieval failure is stated, never replaced with stale catalogue data. |
| Product card | Benefits and dosage fetch approved knowledge for the selected current product. Add to cart asks quantity *before* mutation. Images/interactive buttons are provider-specific but action IDs are stable. |
| Cart | View cart produces a card; remove asks for a resolvable cart line and supports cancel/back; continue shopping reloads current catalogue. |
| Checkout | Requires nonempty cart. It retains the known sender phone and collects name, email, street address, city/state, PIN, country and then explicit GST decision. It rejects an international delivery with a clear India-only response. City/state may be accepted together. |
| Policies | Shipping and return/cancellation menu replies are deterministic channel copy. |
| General Moringa/company | May use channel-approved general facts, while product facts still require fresh tools. |
| Unsupported/media/human/refund requests | Clearly asks for text or explains the limitation; it does not pretend the action happened. |

Checkout normalizes Devanagari/Gujarati digits and digit-by-digit English/Hindi/Gujarati words. It only accepts the known exact length in an active numeric field, preventing unrelated prose/email text from turning into a phone/PIN. It supports Indian phone variants, Indian affirmation/negative phrases, and GST normalization. It never asks the WhatsApp sender for their phone again.

### 4.5 Shared legacy commerce engine and policy enforcement

WhatsApp calls `processWhatsAppTurn()` in `whatsapp-chatbot/conversation/controller.ts`, a channel-specific counterpart of `voice-service/src/conversation/controller.ts`. The controller has access to:

- live active product catalogue and festival deals;
- product resolution designed to tolerate speech/text spelling variants while falling back to a full current catalogue when necessary;
- current unit price, stock bounds, multi-product cart addition, exact quantity update/removal, and server-calculated cart total;
- product-specific approved knowledge records by category/question/version/locale;
- checkout field validation, delivery location, review-link creation, and outbound action collection;
- a bounded LLM tool loop with per-turn tool-call caching;
- output-policy regeneration and safe fallback if a reply makes unsupported price/stock/medical/payment/order claims.

WhatsApp allows modest phone-friendly formatting, but requires tax wording whenever a selling price or total is shown: `₹… (Tax Included)`. It must not label MRP as tax-included. Single-product answers are one or two connected paragraphs, not raw database-label dumps. The model is instructed to ask one question at a time and never use a previous turn’s product facts as proof for a new turn.

### 4.6 Outbound provider capabilities and operational messages

`provider.ts` has Meta/Tata provider adapters for plain text, image, document, interactive product card, checkout template/form, invoice, tracking update, and low-stock alert. Delivery errors preserve provider status and limited response detail for retry diagnosis.

Additional non-conversational entry points:

- `POST /whatsapp/admin/tracking`: server-to-server authenticated tracking update. Validates normalized phone, nonempty order number, and HTTP(S) tracking URL. This supports an update outside the customer’s 24-hour session using a provider template where required.
- `POST /whatsapp/admin/low-stock`: authenticated dispatch alert. The worker also drains `sms_alert_logs` every fifteen seconds so a database webhook outage cannot silently suppress an alert. Claims are atomic to avoid duplicates.
- `GET /health`, `GET /ready`, and a safe `GET /whatsapp/diagnostics` support operations without leaking customer data or credentials.

## 5. Commerce, review, payment, and order boundaries

The required state progression is intentionally stricter than “agent takes an order.”

```text
live catalogue + approved facts
    → transient cart mutations in durable conversation state
    → validated address/contact + optional GST decision
    → editable, expiring review snapshot/form
    → customer explicitly confirms form
    → fresh price/stock validation
    → Razorpay Payment Link / verified payment webhook
    → idempotent database finalizer creates order/payment
    → invoice / tracking notifications
```

`create_checkout_link` / `create_verification_link` is *not* order placement. In the active API it encrypts a `vc1` checkout snapshot with an approximately one-hour expiry, current items, language, and validated customer fields. Viewing the snapshot requeries price/availability. The legacy checkout implementation uses persistent `voice_checkout_sessions` and encrypted/reusable active reviews with fingerprint/expiry controls, then sends the review URL/form.

Only a signed Razorpay webhook is allowed to cross the real order boundary. The webhook verifies the raw-body HMAC before JSON parsing, extracts a stable payment-based idempotency key, and calls `finalize_voice_order` / the latest order-status finalizer. The database transaction locks the checkout session, asserts paid amount/currency against the review-time frozen pricing, creates the order/items/payment, relies on the existing order-item stock trigger for one stock reduction, and marks the checkout finalized. A duplicate payment/webhook cannot create a second order. Invoice output is a signed public reference to a generated PDF; it can be sent to the verified checkout WhatsApp number.

Never say “paid,” “order placed,” or “payment confirmed” from a model/tool pre-payment response. Never collect payment credentials in conversation. This separation is a non-negotiable reproduction requirement.

### 5.1 Legacy Node voice service: complete compatibility map

This section is intentionally separate from the active LiveKit path. The Node service is historical for browser/phone media, but its conversation engine and commerce contracts are shared by WhatsApp. A future engineer needs to understand it for compatibility, migrations, and customer-state recovery—even though they must not deploy it as the current voice media runtime.

`voice-service/src/server.ts` builds Fastify with an explicit CORS allowlist, a global 60/minute limiter, health/ready routes, and route registration order designed to preserve raw-body webhook validation. It exposes:

| Endpoint/interface | Legacy behaviour |
| --- | --- |
| `POST /voice/session` | Creates a persisted `voice_call_sessions` row with serializable initial state. |
| `POST /voice/session/:id/message` | Text harness: validates text, runs `processBrowserMessage`, returns reply text. |
| `POST /voice/session/:id/audio-message` | Push-to-talk audio blob (`audio/*` parsed as raw buffer), STT with state-aware language/numeric hint, transcript trust gate, shared conversation turn, then base64 WAV reply. |
| `GET /ws/voice/session/:id` | Continuous browser PCM16/16 kHz websocket. Server VAD/silence accumulator decides utterances, sends transcript/reply/WAV/audio-end events, and waits for client `audio_done` before resuming/closing. `ping` gets `pong`. |
| `GET|POST /voice/stream/endpoint`, `GET /ws/voice/smartflo` | Historical Tata Smartflo streaming transport. Retained in `routes/smartflo-stream.ts`; not the active phone path. |
| `/checkout/:token` GET/PATCH, `/checkout/:token/payment-link`, `/checkout/:token/status` | Editable review form, repricing/freeze, Payment Link creation, and safe public order status. |
| `/payments/razorpay/webhook` | Raw-body signature verification, durable webhook dedupe, finalizer. |
| `/payments/invoice/:paymentLinkId` | Signed invoice-reference validation and PDF download. |

The continuous browser route is useful to preserve as a specification of old behavior: the initial greeting is stored before it is synthesized; binary PCM is accepted continuously; while the model/TTS is busy, completed utterances queue; outbound sentences synthesize in parallel but transmit in order; client silence is measured only when the caller/agent is not active; and a checkout review ends the socket only after the client confirms audio drain. This is intentionally different from the active LiveKit event and interruption contract.

#### Legacy voice transcript, language, speech, and state mechanics

The legacy transports call `normalizeVoiceTranscript()` before the model. It rejects blank/no-speech/filler-only input, unsupported language codes or scripts, transcription-prompt leakage, and text without letters/numbers. It normalizes Unicode/whitespace, corrects known Earthora mishearings, and caps persisted transcript length. It passes a context-aware language hint only once a language is established or a known numeric field is expected.

Language detection does not switch language on a bare city, short Latin answer, or spoken digit sequence. It recognizes Devanagari, Gujarati, English, and Romanized Hindi/Gujarati cues; explicit “speak Hindi/Gujarati/English” wins even during checkout. Output has a script-level language guard. The speech formatter removes markdown/links/lists/code, normalizes known Hindi/Gujarati wording and long digit sequences, caps normal spoken answers to two sentences/240 characters, and uses localized retry/silence/review-received prompts.

The persisted `ConversationState` is a precise compatibility contract:

- valid user/assistant/tool history where each tool result has the matching prior assistant tool-call ID;
- cart lines `{ productId, productName, quantity, unitPrice }`;
- named checkout fields (name, email, phone, address, city, state, postalCode, country, GST, coupon, consent);
- turn count, current-turn facts only, current language, and whether it is established;
- WhatsApp product/card/quantity and cart-removal subflow state;
- reusable encrypted active-review identity/fingerprint/expiry;
- legacy voice-only “review arrived” confirmation and pending digit confirmation for phone/PIN;
- bounded per-turn transport performance evidence (audio, STT, LLM, TTS, first audio, playback, status/reason).

Current-turn facts are cleared before every turn. `enforceOutputPolicy()` first immediately masks unearned order/payment claims or payment-credential requests. Then, for language, prices, availability, and health/ingredients/dosage claims, it requires successful current-turn tool evidence. The first consecutive attribution failure gets a corrective regeneration instruction; the second receives a localized safe fallback. This is a deterministic heuristic designed to over-block rather than hallucinate.

#### Legacy provider selection and fallback behaviour

The legacy service has configurable provider seams which are **not selected in the active LiveKit voice deployment**:

| Capability | Supported legacy adapters | Important behaviour |
| --- | --- | --- |
| LLM | OpenAI, Sarvam, Plymaxx, `auto` | Adapter choice is configuration-driven; active LiveKit uses Qwen directly instead. |
| STT | OpenAI file STT, OpenAI realtime STT, Google, Sarvam, Plymaxx | Realtime OpenAI telephony STT is a dedicated PCMU WebSocket transcription session; if it is unavailable/late, the Smartflo route falls back to proven utterance/file transcription. |
| TTS | OpenAI, Google, Sarvam, Plymaxx, `auto` | Legacy output is WAV/streamed chunks according to adapter; all are subject to spoken-text formatting. |
| Smartflo media | G.711 mu-law helpers, audio accumulator, old stream route | Has strict frame conversion/resampling, VAD/end-of-speech and bounded buffer logic. The placeholder `TataSmartfloAdapter` class itself is deliberately not an implementation. |

Plymaxx legacy HTTP calls use composed cancellation/deadline signals, classify auth/input/busy/upstream/network failures, bound diagnostic response text, and retry a busy/warming request at most once when configured. Sarvam rotates keys **only** on billing exhaustion (402/insufficient quota) with a five-minute cooldown; it never rotates around 401/403/rate/access failures. These are operational contracts worth preserving if the legacy service remains in use for non-active channels.

#### Legacy checkout state machine in detail

The checkout routes do not trust a client-side total. The opaque review token is stored only as a hash; paid orders remain readable after expiry, while unpaid expired links are rejected. A PATCH validates each allowed customer/item field, refuses edits after payment-link/finalization states, and updates/deletes checkout items through repository methods. Pricing is recalculated from active products and the latest eligible coupon/deal logic; only after explicit review confirmation is the pricing snapshot and each item’s frozen unit price persisted. Payment Link creation is idempotent per review session and disables provider-generated duplicate SMS/email. The status route returns a public order number rather than leaking internal database IDs.

The `voice_checkout_sessions` state values are: draft, link sent, opened, verified, repriced, payment-link-created, payment-confirmed, finalizing, order-created, expired, abandoned, payment-failed, and finalization-failed. `voice_checkout_items` is unique per review/product and separately preserves provisional and frozen unit prices. The Razorpay finalizer chooses `WA-` versus `VA-` order source based on the call-session provider and performs notification side effects only after the paid order transaction; invoice email/WhatsApp failure cannot undo a paid order.

## 5.2 WhatsApp implementation details not visible in the high-level flow

The provider adapter has explicit payload builders for Meta and Tata Omni rather than a generic “send message” abstraction. It validates all outbound media/document URLs as HTTPS, converts product cards to the provider’s permitted interactive shape, uses templates outside a session where necessary, and supports a dedicated checkout form template, signed invoice document, low-stock alert, and shipping tracking update. Product card persistence holds enough body/image/button state to replay the exact card after a delivery failure.

The conversation processor has additional deterministic product behaviour before its LLM loop:

- reloads product details and all approved product knowledge in parallel for the selected/current product;
- sends direct price and maternal-safety replies only from those fresh facts;
- uses a direct catalog reply for simple catalogue requests, so it does not need a model to list stock/price;
- distinguishes “benefits” and “dosage” card actions from general product questions, and refuses to speculate when the knowledge lookup is absent;
- accepts multi-item cart intent through one `add_cart_items` operation, combines duplicate product IDs before stock checks, and records individual line results;
- keeps item-number selection tied to the immediately displayed current numbered catalogue rather than treating every number as a quantity;
- protects checkout-field turns from greetings, invalid digit-on-name entries, menu/back/cart actions, bare GST affirmation, and international delivery ambiguity;
- creates/reuses the review form only when required fields and an explicit GST answer exist, and records the outbound checkout-review action for the provider layer;
- detects database-record dumps in LLM output and gives one formatting regeneration before policy enforcement.

The inactivity database procedure resets only transient product/removal/review/checkout details after five minutes; it keeps cart, established language, and history, appends the localized main-menu notice, increments turn count, and abandons a timeout if a customer message already advanced the turn. This prevents a late timeout from erasing a new order interaction.

### 5.3 Missing messaging-platform source: a real audit limitation

Root `render.yaml` separately declares a paid Python service called `earthora-messaging-platform`, with Meta WhatsApp and Razorpay configuration. **Its declared `rootDir` (`earthora-messaging-platform`) does not exist in this repository checkout.** `.gitmodules` identifies it as a separate GitHub submodule, but it is uninitialized here and the repository handover explicitly classifies it as a legacy Python service that is not part of the current platform. Therefore:

- this document completely describes the visible `whatsapp-chatbot/` durable worker and its shared Node commerce engine;
- it cannot truthfully claim to document the separate, missing Python service’s webhook behavior, knowledge implementation, message ordering, payment behavior, deployment state, or whether it is currently receiving the production WhatsApp number;
- the invariant remains that one WhatsApp number must not point to competing callback services. Before a rebuild or cutover, recover that service’s source/deployment manifest and determine the configured callback endpoint.

This is not a theoretical concern: the root Render blueprint names the Python service while `whatsapp-chatbot/render.yaml` names a distinct Node worker service. Treat them as competing deployment candidates until live configuration proves otherwise.

Historical Git confirms the source boundary: commit `c7bbcc0` recorded the Python service as gitlink `60ae6f2f0c837e0fff8f92fd09568bb423fe7f15`; a later repository commit deleted that gitlink. The declared submodule remote was not accessible from this environment during this audit. Its implementation cannot be recovered from a gitlink SHA alone, so no undocumented behavior is attributed to it here.

## 6. Persistent data contracts

| Data | Purpose | Important constraints |
| --- | --- | --- |
| `products`, pricing/deals | Current purchasable catalogue | Status/stock/price are loaded at time of action; no parallel hard-coded catalogue. |
| `product_knowledge` | Canonical approved product records | Tenant/Earthora membership, active product, approved state, effective dates, category/question/version/locale. Conflicts stay visible. |
| `kb_documents`, `kb_chunks` | Supplemental public knowledge | Public, indexed, effective, authority-ranked only. |
| `conversations` / active platform state | LiveKit API conversation, cart, checkout, history | Session namespace includes channel ID/type to prevent accidental sharing. |
| `voice_call_sessions` | Legacy/WhatsApp conversation state | JSON state, expiration, provider; WhatsApp uses this as shared state anchor. |
| `whatsapp_sessions` | Number-to-session lookup | E.164 key, 24-hour lifecycle, flow timeout metadata. |
| `whatsapp_message_events` | Inbox/outbox state machine | Unique provider ID, per-phone ordering, leases, replay-safe reply/media delivery. |
| `voice_checkout_sessions`, `voice_checkout_items` | Review/payment staging | No real order ID until finalization. |
| `payment_webhook_events` | Payment webhook dedupe | Used before/alongside finalization. |
| `escalations` / Studio request data | Contact/callback commitments | Draft → reviewed → explicitly submitted; notification work is server-side. |

## 7. Build a new agent “like this”: mandatory blueprint

1. **Define business truth first.** Put product, price, stock, approved knowledge, checkout, order, and request functions behind a server-owned typed API. Make model tools a narrow allowlist with strict schemas.
2. **Create an evidence model, not just embeddings.** Canonical records need approval state, version, effective dates, product/category/question/locale provenance. Retrieve public passages separately. Preserve conflicts and abstain on missing/conflicting evidence.
3. **Use a current-turn evidence gate.** Make price/stock/product-health claims require a successful current turn tool/evidence record. Validate output before it can be spoken or sent.
4. **Keep mutations idempotent and serialized.** Bind a native call ID to a side effect, cache both results and failures, serialize per conversation, and reject an ID reused with different content.
5. **Make caller interruption a state boundary.** Advance an epoch when the user speaks; do not execute/carry forward stale tools, stale navigation, or stale review confirmation.
6. **Persist asynchronous channels before delivery.** For WhatsApp/SMS/email, durable-inbox the inbound item, commit new state plus exact response atomically, then deliver. On retry, replay the response instead of recomputing the turn.
7. **Preserve per-user message order.** Leases alone are insufficient; later events must wait behind earlier retryable events for the same identity.
8. **Treat review as the customer confirmation boundary.** Conversation may assemble a cart and delivery details, but only an editable review plus explicit confirmation can create a payment opportunity. A provider-verified payment path alone creates the order.
9. **Build media adapters around cancellation and bounded resources.** Limit concurrent GPU request/room admission, cap input/output sizes and timeouts, cancel work on barge-in, and test real audio framing separately from model quality.
10. **Instrument without collecting secrets or excessive PII.** Hash phone references in logs, suppress callback URL/token logging, use structural diagnostics, and keep provider bodies/transcripts out of error messages.
11. **Test the failure paths as acceptance criteria.** Include duplicate webhooks, lost delivery after state commit, out-of-order messages, stale tool replay, interrupted review, empty/conflicting knowledge, changed stock at checkout, duplicate payment webhook, invalid audio frames, provider retry, mute/idle/reconnect, language switch, and unsupported STT language.

## 8. Deliberate limitations and facts not to overclaim

- The active voice path has a two-session cap and completed-utterance GPU STT/TTS; it is interruptible but not a native streaming-model latency guarantee.
- Synthetic browser/Smartflo transport verification is documented, but it is not proof of real PSTN carrier routing, handset audio quality, or broad real-speaker recognition accuracy.
- The current evidence set can contain contradictory usage directions. The agent abstains; it does not silently reconcile them.
- Voice and WhatsApp share commerce rules but do not share the same media/runtime architecture. Do not replace WhatsApp’s durable worker with a synchronous LiveKit-style callback handler.
- The legacy Render voice stack is retained for business/repository reference. It must not be reinstated as the active media implementation without an explicit migration decision.

## 9. Primary source map

- Active agent and lifecycle: `livekit-voice/server/earthora_agent.py`
- Evidence selection, language and output guards: `livekit-voice/server/sunpath_runtime.py`
- GPU STT/TTS and pacing: `livekit-voice/server/plymaxx.py`, `speech_pacing.py`
- Browser and Smartflo media transports: `livekit-voice/browser/transport.ts`, `livekit-voice/server/earthora_control.py`
- Browser/enquiry controls: `browser_actions.py`, `conversation_controls.py`, `concierge_controls.py`, `request_collection.py`, `request_review.py`
- LiveKit/API tool boundary and canonical retrieval: `apps/api/src/platform/channels/sunpath.ts`, `sunpathKnowledge.ts`, `voiceConcierge.ts`, `voiceCheckout.ts`, `voiceTurns.ts`, `siteGuide.ts`
- Session admission and retained platform voice bridge: `apps/api/src/platform/channels/livekit.ts`, `voice.ts`, `apps/api/src/platform/providers/plymaxx.ts`
- Shared tool registry/current commerce functions: `apps/api/src/platform/engine/functions.ts`; legacy shared engine: `voice-service/src/conversation/`, `voice-service/src/tools/`, `voice-service/src/payments/`
- Legacy media, checkout, provider, repository and notification contracts: `voice-service/src/routes/`, `adapters/`, `telephony/`, `repositories/`, `providers.ts`, `notifications/resend.ts`
- WhatsApp ingress, worker, state, provider adapters: `whatsapp-chatbot/routes.ts`, `inbound.ts`, `worker.ts`, `events.repository.ts`, `sessions.repository.ts`, `provider.ts`, `conversation/controller.ts`, `checkout-validation.ts`, `product-card.ts`, `low-stock.ts`
- Database guarantees: `supabase/migrations/schema_agent.sql`, `whatsapp_sessions.sql`, `20260905000000_whatsapp_chatbot_inbox.sql`, `20260907120000_whatsapp_outbound_media.sql`, `20260909000000_whatsapp_claim_media.sql`, `20260910143000_whatsapp_flow_timeout.sql`, and the latest checkout/order-status migrations.
- Behavioural test contracts: `livekit-voice/server/tests/`, `apps/api/src/platform/channels/*.test.ts`, and `voice-service/tests/`.

## 10. Implementation reference appendix — exact visible contracts

This appendix is deliberately dense. It is the non-marketing reference for a future rebuild and supplements the architectural sections above. It includes every visible runtime surface relevant to voice or WhatsApp; it does not invent behavior for the uninitialized legacy Python submodule.

### 10.1 Active voice boot, dependencies, and deployment boundaries

`livekit-voice/server/Dockerfile.earthora` is the active image recipe. It pins Python 3.12, CPU Torch for local VAD/runtime support, LiveKit Agents/Silero/OpenAI-plugin/turn-detector at 1.3.12, LiveKit RTC 1.0.23, LiveKit API 1.1.0, FastAPI/Uvicorn/HTTPX/WebSockets, FFmpeg, and the fixed model/support libraries. The image downloads the agent files at build time and starts `earthora_agent.py`; it is not the upstream generic `Dockerfile`/`compose.yml`, which launch the unrelated `agent.py`/token-server reference services.

`compose.earthora.yml` is the active composition:

| Service | Network/listener | Role | Resource limit |
| --- | --- | --- | --- |
| `sfu` | Host network; LiveKit config mount | LiveKit Server 1.9.12 signalling/SFU | Docker logging rotation |
| `voice-control` | private `earthora_default`; host maps only `127.0.0.1:7860` | FastAPI room-token and Smartflo bridge | 512 MiB |
| `agent` | Host network; talks loopback SFU/API | named LiveKit AgentSession worker | 4 GiB |

The deployment values distinguish public signalling from internal calls: browser sees a room-scoped token and public `wss` URL; the control/agent use private API URLs and the internal voice key. The compose does not migrate schemas or rebuild the storefront. GPU inference is a remote/self-hosted owner endpoint selected through `AI_BASE_URL` and `AI_API_KEY`; no voice provider fallback is configured in `sunpath_config.py`.

### 10.2 Active API route contracts

| Route | Caller | Validation and result |
| --- | --- | --- |
| `POST /platform/voice/livekit/session` | browser widget | `{ channelKey, conversationId?: /^[A-Za-z0-9:_-]{1,180}$/, language?: auto|en|hi|gu }`; enabled `voice` channel required; creates/loads a `voice_…` external conversation and returns `{ token, url, room_name, conversationId }`. |
| `POST /platform/voice/internal/session` | Smartflo control service | timing-safe internal Bearer key; `{ channel:'phone', provider_call_id, language? }`; hashes provider call ID into stable `phone_<40 hex>` identity; restricts to the phone channel key. |
| `POST /platform/voice/internal/turn` | retained old Earthora bridge | timing-safe internal key; validates bounded text/turn/session/channel; queue serializes by tenant/channel/type/session and rejects changed replay; persists user, runs tenant-scoped platform engine, persists assistant/tool history/state. |
| `GET /platform/voice/:channelKey/config` | older widget setup | published persona/name/greeting/voice, supported languages, and LiveKit-on/off only; no secret. |
| `POST /platform/voice/:channelKey/session` | older widget setup | returns a fresh `voice_…` conversation ID. |
| `POST /platform/voice/turn` | older multipart browser voice | 8 MiB maximum audio; STT → platform engine → MP3 TTS response. This is a retained non-LiveKit route. |
| `GET /platform/voice/site-guide` | active browser navigation client | public, short-cache allowlisted destinations derived from fixed pages plus active products. |
| `GET /platform/voice/checkout/*` | active review UI | no-store/no-referrer; valid encrypted `vc1` snapshot only; returns repriced items, availability and customer display data. |
| `POST /platform/voice/internal/context|tool|record|flow-request` | active agent only | timing-safe internal key, bounded schema/payloads, serial state changes, current channel tenant isolation. |

The active `SunPathBridge` makes no retries and never follows redirects with its credential. It rejects malformed/oversized (>160 KiB) API responses and validates the response shape before passing it into the agent. `VoiceContext` allows only `web`/`phone`, normalizes `en`/`hi`/`gu`, requires a session/channel key, and bounds greeting metadata.

### 10.3 Active tool data semantics

The API builtin registry (`apps/api/src/platform/engine/functions.ts`) uses a mutable in-memory conversation cart during one server operation; `sunpath.ts` saves resulting state after successful tool execution. Tool arguments are schema-validated both in the agent and API. Native voice adds stricter rules than generic platform tools: exact active product IDs are mandatory for `get_product_details`, `add_to_cart`, and `update_cart`; fuzzy aliases and the generic “only product” fallback are prohibited.

| Builtin | Input constraints | State/result contract |
| --- | --- | --- |
| `list_products` | optional bounded query | current products, INR price/MRP, and normalized `in stock`/`low stock`/`out of stock`; query miss safely returns catalogue. |
| `get_product_details` | exact product ID in native voice | description/highlights/current price/MRP/stock/image. |
| `search_knowledge` | query required; optional current active product ID | native path runs canonical+public retrieval; product ID outside current active catalogue fails closed. |
| `add_to_cart` | exact product ID; quantity 1–50 | clamps/checks total line <=50 and available stock; adds `{ id, slug, name, quantity, unitPrice }`. |
| `update_cart` | exact product ID; quantity 0–50 | 0 removes; nonzero requires active product/current stock. |
| `get_cart` | none | runs server `priceCart`, not client arithmetic. |
| `set_customer_detail` | field limited to name/phone/email/address/city/state/zip/country; max 500 chars | updates checkout field only; cannot store a secret field. |
| `create_checkout_link` | none | requires cart plus name/phone/email/address/city/state/zip; validates customer; reprices/stock-checks; emits expiring encrypted snapshot and web open-checkout action, with `order_placed:false`. |
| `get_order_status` | order number plus matching phone or email | returns public status/total/date/tracking only after identity match. |
| `capture_callback` | present in generic registry only | native voice explicitly rejects it in favor of reviewed requests. |

The concierge request tools enforce their own strict schemas: request ID must be UUID for field/review operations; confirmation token is exactly 48 lowercase hex characters. Every edit increments draft revision and invalidates confirmation hash, review user sequence, and review expiry. Contact starts with `marketingConsent:false`, generic topic, and blank optional phone; callback starts empty. Inputs reject HTML/script-shaped text, validate E.164/Indian phone forms, validate email, and cap name/topic at 120, contact message at 4,000, callback reason at 2,000. Submission requires configured team notification capability before it writes a committed “submitted” result.

### 10.4 Active runtime state machine

```text
room admitted
  → VAD detects completed caller utterance
  → STT final transcript / recoverable recognition clarification
  → increment turn, choose current language, persist user transcript
  → fresh API context (catalogue + canonical/public knowledge + cart + drafts)
  → deterministic language/policy/concierge branch OR Qwen native tool chain
  → evidence/tool result compaction and final reply validation
  → persist assistant text → emit data event → TTS
  → interruption clears stale work OR await terminal speech then close
```

`EarthoraAgent` maintains: current language and detected language, user-speech epoch, turn count/max turns, current `TurnState`, error streak, a map binding native tool-call ID to current turn, review-token maps/blocked tokens, per-turn request-field attempts, and a caller navigation preference. It does not retain unsafe tool results after a new turn. A tool call is rejected if its bound turn is no longer current or its speech epoch differs.

`TurnState` carries fresh text/language/data, tool results, search-attempt marker, visible evidence, reply count, and speech epoch. Context building keeps at most five complete user/tool groups, then removes older groups before selected knowledge; it never splits an assistant tool call from its tool result. If it still cannot fit under the 7,600-token operational budget (tool-schema cost plus context), it fails safely instead of relying on model-side truncation.

Reply selection priority is: exact language-only acknowledgement → deterministic policy reply → deterministic concierge navigation/request action → deterministic knowledge retrieval prerequisite → local approved localized fact where eligible → Qwen. On a normal model reply, it strips markdown/emoji via LiveKit transforms, normalizes spoken text, trims unsolicited sales follow-ups, applies narrow Hindi grammar repair, validates evidence/safety, bounds speech, records it, and only then yields text to TTS. A tool-bearing chunk carries tool calls but no model text to speech.

#### `earthora.voice` data-event contract

The agent emits reliable JSON on the fixed `earthora.voice` topic. The browser treats only an `AGENT` participant as authoritative and ignores malformed/oversized packets. Event families are:

| Direction | Event | Meaning |
| --- | --- | --- |
| Agent → client | `user_transcript` | final recognized caller text, duplicate `transcript` field, language, and turn ID. |
| Agent → client | `agent_reply_text` | deterministic or generated speech text, language, and optional turn ID; text has already passed the guard. |
| Agent → client | `agent_state`, `user_state` | LiveKit session state transitions for UI status. |
| Agent → client | `speech_generation` | synthesis boundary before audio packets; phone clears its drop state here. |
| Agent → client | `agent_interrupted` | SDK confirmed speech interruption; phone sends provider `clear`. |
| Agent → client | `error` | localized retry/unavailable information, optionally turn-bound. |
| Agent → client | `call_end` | final reason: farewell, turn/session limit, silence, errors, or provider/session closure. |
| Agent → browser | `navigate_site`, `cancel_navigation`, `request_voice_state` | caller-bound navigation/mute-state protocol only. |
| Client → agent | `client_voice_state` | `{ muted:boolean }`, accepted only from original caller identity and bounded to 4 KiB. |
| Client → agent | `client_action_result` | navigation acknowledgement matched to action ID and exact requested destination. |

`BrowserActions` has at most one pending navigation per action ID, cancels an outstanding action when the user begins speaking, and refuses cross-participant/action-conflict acknowledgements. The browser navigation helper independently permits only canonical fixed public paths or constrained `/product/<id>`, validates anchors/action IDs, caps remembered actions at 100, coalesces retransmits, and sends explicit unavailable/cancelled/conflict results. The agent never claims a page opened until that result returns `ok:true`.

#### Smartflo wire contract

The current control bridge acts on `start`, `media`, `mark`, and `stop` JSON events over `/ws/voice/smartflo`; a provider may send a preliminary `connected` frame, but it has no side effect. A start must supply stream/call identity, `audio/x-mulaw`/PCMU and 8 kHz. Caller media is base64-decoded with a 64 KiB per-frame ceiling, mu-law decoded, resampled to 16 kHz, then published as the room microphone. Agent audio is subscribed at 8 kHz, converted to mu-law, buffered and paced in 160-byte chunks (20 ms each). A barge-in increments the output epoch, discards buffered chunks, and sends `clear`; stale chunks can never be transmitted after it. On closing speech the bridge waits for audio drain, sends a uniquely named provider `mark`, waits up to three seconds for its acknowledgement, then closes. Socket read timeouts are 15 seconds before start and 90 seconds after; full bridge lifetime is capped at 20 minutes. Every cleanup attempts task cancellation, room disconnect, audio-source close, and explicit room deletion independently.

### 10.5 Active safety/knowledge decision table

| Situation | Required action |
| --- | --- |
| Exact current product price/stock/product existence | live catalogue/detail tool/evidence in the current turn. |
| Product ingredients, benefits, direction/dose, warning, contraindication | active effective approved product knowledge; missing record means abstain. |
| Conflicting canonical source records | state conflict / do not choose a record or synthesize a compromise. |
| Personal medical outcome, cure/treat/prevent, diagnosis | do not make claim; direct toward qualified medical advice when appropriate. |
| Dispatch schedule without explicit source calendar/cutoff | say schedule is unconfirmed; do not infer it from shipping duration. |
| Purchase intent | ask exact quantity; do not convert it into dosage advice. |
| OTP/CVV/UPI PIN/card/bank password | warn not to share; never request/repeat it. |
| Unknown named product | clarify instead of mapping it to approximate product. |
| Unsupported STT language | re-decode original audio using current supported-language hint once; if still invalid, one localized repeat prompt, session remains alive. |
| Tool/API failure | say request cannot be confirmed; do not retry a mutation automatically. |
| Agent interruption | invalidate any review, block stale tool/navigation, clear phone playout only after actual SDK speech interruption. |

Canonical retrieval accepts only the Earthora tenant, current active catalogue IDs, `approved` records in their effective date range, and retains every version. Public supplemental retrieval accepts tenant-local `public` indexed document/chunks in their effective date range. Canonical content is intentionally full; compacting happens only in current-turn Python selection, preserving source metadata. Public document chunks are capped/authority-ranked and retrieval is top six. The source-localization path is constrained: a cached translation is accepted only if it binds the full current source digest and all caveats; it cannot fill missing evidence or resolve conflicts.

### 10.6 WhatsApp endpoint and provider contract

| Capability | Meta Cloud path | Tata Omni path | Common protection |
| --- | --- | --- | --- |
| inbound verification | GET `hub.mode`/verify-token/challenge; POST raw-body HMAC SHA-256 | POST header/path/query shared secret | timing-safe comparison, silent webhook logging, raw bytes authenticated before JSON parse. |
| normal text | Graph `/messages` payload | `/whatsapp-cloud/messages` payload | 8-second delivery deadline; non-OK turns into typed delivery error with bounded body. |
| image/document | HTTPS URL only | HTTPS URL only | rejects non-HTTPS before provider request. |
| product card | interactive button/header/image structure | Omni-specific interactive shape | button IDs encode action + URI-encoded product ID. |
| checkout | approved template if configured, else normal message in service window | configured Tata checkout template | link says review/edit first, not paid/order placed. |
| invoice | document/template with signed public PDF URL | document/template | only after finalizer returns paid order. |
| tracking | template if configured or Meta service-window text fallback | requires approved Tata tracking template | normalized E.164 recipient and valid HTTP(S) tracking URL. |
| low stock | three-placeholder utility template or normal windowed text | same | admin-only authenticated route/poller; atomic database claim. |

Button protocols are deliberately stable:

```text
earthora_product:<benefits|dosage|add_to_cart>:<encoded-product-id>
earthora_cart:<view_cart|checkout|continue_shopping|main_menu|remove_item>
```

Inbound normalization transforms those to internal `__earthora_whatsapp_*_action__:` forms, but parsers also accept raw IDs for provider variation. Plain-text Benefits/Dosage/Add-to-cart is accepted only with a current product-card context. Persisted cards serialize validated HTTPS image/body/button data with private prefixes; replay restoration rejects malformed JSON/shapes instead of delivering arbitrary provider payload.

### 10.7 WhatsApp exact inbox state transitions

| Database event state | How it is entered | Next outcome |
| --- | --- | --- |
| `pending` | new unique provider event | claim when due and no older unresolved message for same phone. |
| `processing` | `claim_next_whatsapp_message()` row lock | run customer turn or replay reply; stale after five minutes may be reclaimed. |
| `reply_ready` | atomic `complete_whatsapp_message_turn_v2` commit | worker only delivers persisted text/media; never recomputes customer turn. |
| `processed` | text/card/image/timeout delivery succeeds | terminal. |
| `failed` | processing/delivery error | retry with 5×2^(attempt−1) seconds, capped at 300 seconds; at five attempts no longer claimed. |

The `complete…v2` stored procedure updates the `voice_call_sessions` JSON state and expiry (+24h), WhatsApp last-active and flow-timeout metadata, and event reply/media fields in one transaction. A missing claimed row/session raises instead of silently succeeding. Media is marked sent independently after delivery; an already stored reply with media not marked sent sends only the missing media, then marks processed. Per-phone ordering uses `(created_at,id)` comparison against all earlier nonprocessed, still-retryable events; it is stronger than a simple queue lock.

The worker constants are 750 ms normal poll, at most ten events per drain, 15 seconds low-stock poll, and at most ten expired flow timeouts per drain. Process shutdown clears both timers. Health is liveness only; readiness exposes just configuration boolean/provider/revision, never tokens. General endpoints use a 60/minute limiter; authenticated provider callbacks bypass the limiter because the durable inbox/deduplication is the correct burst control.

### 10.8 WhatsApp turn-processor order of operations

`processWhatsAppTurn()` follows this ordering before falling back to the bounded LLM tool loop:

1. Parse structured product/cart action, menu selection, product-number selection; increment state turn count; clear current-turn facts; append only non-button user text to history.
2. Apply explicit language request, otherwise confidently detect a non-greeting language; preserve prior language for short/ambiguous answers.
3. Handle current cart summary/pricing request.
4. If a product card awaits a numeric quantity, validate positive integer, call the cart tool, and return post-add card without model inference.
5. Resolve active cart-removal state, including main-menu/back/view-cart/checkout/continue-shopping exceptions.
6. Resolve menu, view cart, remove item, checkout reset/start, continue-shopping, policy, shipping, and return/cancellation deterministic paths.
7. Interpret an active checkout question before general NLP. A casual greeting, menu/back/cart command, bare `checkout`, invalid numeric name, or malformed GST yes does not get saved as a customer field.
8. Resolve current product from structured action, a fresh numbered catalogue, explicit/current product context, or live catalogue lookup. Fetch details and all approved knowledge in parallel when it is needed.
9. Return deterministic product price, maternal-safety, catalog, product-card, benefits/dosage, and quantity prompts where appropriate.
10. Construct the LLM context with the WhatsApp system prompt, full current persistent state, freshly retrieved facts, tool schemas, checkout instruction, and transient output correction. Execute a bounded tool loop with exact tool-call cache.
11. On tool success, prefer deterministic checkout-review or cart-mutation reply. Otherwise enforce output policy; one formatting regeneration is allowed for raw record dumps and one policy regeneration for unsupported factual claims, then a safe fallback.

Required checkout order is name → email → (sender phone already populated) → street address → city/state → PIN → country → explicit GST decision. `isCheckoutReady` requires nonempty cart, every required field, and `gst !== undefined`; `No` becomes empty GST so omission cannot skip the decision. Normalizers understand ASCII/Devanagari/Gujarati digits plus English/Hindi/Gujarati spoken-digit sequences and only extract natural language digits during a known numeric field at exact expected length.

### 10.9 Legacy configuration inventory (no secret values)

| Group | Required at Node service boot | Optional/feature-specific controls |
| --- | --- | --- |
| Core | environment/port/log level; public app URL; Supabase URL/service key | Google project/credential JSON. |
| AI | OpenAI key/model/STT model; LLM/STT/TTS provider selectors | Sarvam keys/model/STT probability/TTS speakers/temperature; Plymaxx base/key/model/endpoints/per-language models/voices; Google settings. |
| Voice timing | — | STT/LLM/TTS timeouts, RMS threshold, ordinary/numeric endpointing, realtime-STT toggle/model, public Smartflo WSS URL. |
| Payments/PII | Razorpay ID/secret/raw-webhook secret; token-signing secret >=16; AES-256-GCM PII key (64 hex); checkout TTL | public voice service/invoice URL and internal storefront invoice key. |
| WhatsApp | — | provider, Meta identifiers/tokens/HMAC token, Tata credentials/callback secret, checkout/tracking/low-stock/invoice template names/languages, timeout tick secret, internal admin key. |
| Notifications | Resend API key/from address | Tata SmartFlow credentials; capability is disabled rather than boot-failed when optional pieces are absent. |

Legacy provider selectors are not a promise that all are configured: `auto` routing chooses Sarvam for Hindi/Gujarati and OpenAI for English/failure fallback in the old layer; legacy Plymaxx STT/TTS has asymmetric language models; active LiveKit does not use this selection matrix. The Node service warns at boot for unavailable optional providers but only fails boot for its required core/payment/PII configuration.

### 10.10 Test and verification inventory

The active Python test suite directly covers scheduling/admission capacity, browser action identity/ack/cancellation/replay, control/Smartflo framing and cleanup, agent bridge input validation, concierge controls/workflow/review/collection, conversation policies/language/navigation, GPU STT/TTS error paths/queue/bounded retry/barge-in cancellation, source-fact localization/conflict/missing-evidence behavior, pacing, runtime guards, and synthetic full lifecycle/smoke/tool/QA probes.

The Node/WhatsApp suite covers at minimum inbound Meta/Tata normalization, strict greetings/menu behavior, card action IDs, dynamic product/card paths, cart quantities/multi-line stock changes, checkout-question context and city/state/PIN/GST cases, output-policy regeneration/fallback, durable inbox replay/media recovery/per-phone ordering/timeouts, Razorpay raw HMAC/idempotency/concurrent finalizer behavior, pricing fixtures, provider templates, tracking and low-stock paths. These are the acceptance contracts to port before changing an implementation; a source read is not a substitute for running the relevant suite after code changes.
