# Public profile discovery tools

These directories are controlled backend tool snapshots used by the AdRoom AI
Profile Builder queue. They are not application dependencies, frontend assets,
or connected services. The pinned repository sources, workspace revisions, and
actual adapter entry points are recorded in `profile-tools.manifest.json`.

## Runtime boundary

- Only sanitized public usernames reach these adapters.
- They run from the backend worker, never in a mobile/web request.
- No cookies, session tokens, API keys, email addresses, phone numbers, or
  other private identifiers are passed to them.
- Each invocation has a timeout, output cap, per-tool delay, and fallback to
  the credential-free web router when it returns no usable public evidence.
- Raw tool output is discarded after the adapter maps it to public URL/excerpt
  evidence.

## Repository source correction

The repository URL supplied for Deepkrak3n,
`https://github.com/guilhermelimait/deepkrak3n.git`, returned HTTP 404 during
verification. The snapshot uses the working `fchr80/deepkrak3n` repository,
whose backend documents the same `POST /api/search/username` interface.

Reddeye is a Firefox extension and has no server API. Its adapter intentionally
uses only the public Reddit endpoints implemented in its background script and
does not reproduce its credentialed Groq dossier generation.