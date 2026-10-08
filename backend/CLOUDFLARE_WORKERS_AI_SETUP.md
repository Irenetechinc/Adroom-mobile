# Cloudflare Workers AI setup

This provider uses Cloudflare's REST API directly. It adds no SDK, worker binding, package, or provider dependency.

## Server environment

Configure these variables in the backend server environment. Keep tokens in the host's encrypted environment-variable store; never put them in source code, prompts, database rows, or logs.

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID_1` | Workers AI account used for text inference |
| `CLOUDFLARE_API_TOKEN_1` | Token for the text account |
| `CLOUDFLARE_ACCOUNT_ID_2` | Separate Workers AI account used for image generation |
| `CLOUDFLARE_API_TOKEN_2` | Token for the image account |

The account tokens need the Workers AI permissions required by Cloudflare's REST API. The backend only reports whether a credential pair is configured; it never returns account IDs or tokens to the admin UI.

Optional model overrides:

| Variable | Default |
| --- | --- |
| `CLOUDFLARE_TEXT_MODEL` | `@cf/meta/llama-3.2-1b-instruct` |
| `CLOUDFLARE_TEXT_FALLBACK_MODEL` | `@cf/meta/llama-3.2-1b-instruct` |
| `CLOUDFLARE_IMAGE_MODEL` | `@cf/black-forest-labs/flux-1-schnell` |
| `CLOUDFLARE_IMAGE_FALLBACK_MODEL` | `@cf/black-forest-labs/flux-1-schnell` |

The AI caller may also supply a Cloudflare model choice in its internal request context. A rejected model is retried once with the task's configured fallback model.

## Supabase and admin controls

1. Run `cloudflare_workers_ai_migration.sql` against the Supabase database used by the backend.
2. Open **Admin → CMA Savings Dashboard → Cloudflare Workers AI**.
3. Enable the provider independently for tiered free users and universal free mode.

Both switches default to off. The text and image accounts are used only for their respective task types. Existing free providers remain in the fallback rotation.

## Quota and monitoring

Cloudflare's free allocation is 10,000 Neurons per account per UTC day. The admin panel reports estimated Neurons from returned token usage and published model rates, plus routed calls and account health. These estimates are not Cloudflare's billing record; use Cloudflare's account dashboard as the authority.

For model IDs outside the listed rate card, the backend uses the highest rate from its supported text models, or the standard image estimate, rather than recording zero usage.

Requests have a 30-second timeout. Rate/quota responses are marked exhausted for the current UTC day; credential rejection is marked unhealthy and sent to the authenticated admin event stream. In either case, the existing free-provider rotation continues.
