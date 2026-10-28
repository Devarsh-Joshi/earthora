# Earthora real-domain DNS and cutover

Inspected 21 September 2026. This is a prepared target configuration; no DNS records or production domain settings were changed. The owner still needs to confirm the final domain. Existing application configuration already lists `earthorafarms.com`, so the examples below use it.

## DNS records

The verified Earthora VPS is **187.52.121.146**. The domain currently delegates DNS to Cloudflare (`abby.ns.cloudflare.com`, `moura.ns.cloudflare.com`). Its apex and `www` resolve to Cloudflare proxy addresses; `ai.earthorafarms.com` currently returns NXDOMAIN. Public DNS does not expose the existing proxied origin IP.

At the planned cutover, create or edit these records in the selected domain's authoritative DNS zone:

| Type | Name | IPv4 value | TTL | Purpose |
| --- | --- | --- | --- | --- |
| A | `@` | `187.52.121.146` | 300 | Storefront and business API |
| A | `www` | `187.52.121.146` | 300 | Website alias, redirected to the chosen canonical hostname |
| A | `ai` | `187.52.121.146` | 300 | Existing Earthora AI administration console |

Use DNS-only (grey cloud) for the initial direct-origin validation; this is a cutover/testing choice. Cloudflare explains the distinction at https://developers.cloudflare.com/dns/proxy-status/ . Edit an existing record rather than adding a conflicting second destination. Preserve email and verification records. Do not replace the currently live apex/`www` records before the server-side domain configuration is prepared.

No separate `api` DNS record is required by the current deployment. Its public nginx host already routes these services by path.

## Resulting URLs if the final domain is earthorafarms.com

| Service | Target URL |
| --- | --- |
| Website | `https://earthorafarms.com/` |
| Store administration | `https://earthorafarms.com/sun-earthora/` |
| AI administration console | `https://ai.earthorafarms.com/` |
| Earthora business API | `https://earthorafarms.com/api/` |

These are target URLs, not a statement that they are live today. DNS supplies hostnames/IPs; the paths above are server routes.

## Server and integration work required with DNS

1. Prepare the existing nginx storefront/console virtual hosts for the confirmed names, preserve current temporary hosts during testing, and provision valid TLS certificates. Verify the existing API, assets and widget route mappings under the new hosts.
2. Set API `PUBLIC_STORE_URL`, `PUBLIC_API_URL`, `PUBLIC_CONSOLE_URL`, `ASSETS_PUBLIC_BASE` and allowed CORS origins to the confirmed HTTPS URLs. Inspect built storefront/console assets and persisted integration settings for absolute temporary-host references before cutover.
3. After HTTPS validation, audit checkout/payment, notification links, callback/webhook registrations, widget origins and website knowledge-source URLs for hostname references.
4. Verify canonical redirects, admin login, typed chat and proactive navigation. Keep temporary endpoints available until clients/integrations have been verified.
