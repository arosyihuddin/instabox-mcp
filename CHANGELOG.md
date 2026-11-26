# Changelog

## 0.4.1 (2026-11-05)

- `delete_machine` and `delete_snapshot` now send the `X-Confirm-Delete` header InstaBox
  requires on deletes, set to the ID (or machine name) the tool was called with. Without it,
  deletes with newer API keys failed with `409 delete_confirmation_required`.
- Added `npm test` (Node's built-in test runner against a mock InstaBox API) and run it in CI.

## 0.4.0 (2026-10-28)

- Client ID Metadata Documents (MCP SEP-991): HTTPS-URL `client_id`s are fetched and validated,
  with SSRF protection and caching. Dynamic client registration still works.
- Optional static bearer for `/mcp` via `MCP_BEARER_TOKEN`.
- New env vars: `CIMD_ENABLED`, `CIMD_ALLOWED_HOSTS`, `MCP_BEARER_TOKEN`.

## 0.3.0 (2026-10-26)

- Org and machine secrets tools; `create_machine` accepts `secrets` and `envSecrets`.

## 0.2.1 (2026-10-24)

- Login page CSP allows the post-login redirect back to the client.

## 0.2.0 (2026-10-24)

- Desktop / computer-use tools.
