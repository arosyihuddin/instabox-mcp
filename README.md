# instabox-mcp

A remote MCP server for [InstaBox](https://instabox.sh) cloud machines, made for web clients
(Claude.ai, ChatGPT) that can't run the InstaBox CLI. It speaks Streamable HTTP and has its own
single-user OAuth login, so connecting a client is: paste the URL → enter your password → done.

## Tools

| Area | Tools |
|---|---|
| Account | `whoami`, `get_usage`, `list_templates` |
| Machines | `list_machines`, `get_machine`, `create_machine`, `update_machine`, `delete_machine` |
| Lifecycle | `start_machine`, `stop_machine`, `pause_machine`, `resume_machine`, `get_operation` |
| Commands & files | `run_command` (with `background` mode), `read_file`, `write_file` |
| Snapshots | `list_snapshots`, `create_snapshot`, `delete_snapshot` |
| Public ports | `publish_port`, `list_ports`, `unpublish_port` |
| Secrets | `list_secrets`, `set_secret`, `import_secrets`, `delete_secret`, `get_machine_secrets`, `set_machine_secrets`, `refresh_machine_secrets` |
| Desktop (computer use) | `desktop_start`, `desktop_status`, `desktop_screenshot`, `desktop_action`, `desktop_cursor_position`, `desktop_stream_url`, `desktop_revoke_streams`, `desktop_takeover`, `desktop_handback` |

Lifecycle tools wait up to ~45s (web clients time out around a minute) and otherwise return the
operation ID to follow with `get_operation`. Long commands should use `run_command` with
`background: true`, which logs to `~/.mcp-jobs/<job>.log` in the machine.

`delete_machine` and `delete_snapshot` send InstaBox's `X-Confirm-Delete` header with the ID
(or machine name) the tool was called with, as the API now requires. If InstaBox still answers
`409 delete_confirmation_required`, the tool returns that error and nothing is deleted.

## Computer use

Machines have an optional Linux desktop (Xfce + Chromium). The model can see and drive it:

1. `desktop_start`: installs the desktop on first use (~30s, once) and starts it.
2. `desktop_action` with `open_url`, `click`, `double_click`, `right_click`, `move`, `drag`,
   `scroll`, `type` or `key` (e.g. `ctrl+l`). It returns a screenshot afterwards by default,
   so each step is one round trip.
3. `desktop_screenshot` any time. Images are JPEG by default (`format: "png"` for sharp text).

`desktop_stream_url` gives you a live link to watch along in your own browser (view-only by
default). Input runs through `xdotool` on display `:1`, the same way the official SDK does it.

## Secrets

Org Secrets keep API keys out of your machines' files. Two delivery modes:

- **proxy** (recommended): the machine only sees a placeholder. InstaBox's egress proxy swaps in
  the real value on HTTPS requests to the hosts you allow (e.g. `api.openai.com`), so the key
  never enters the machine.
- **env**: the real value is installed as an environment variable in machines that select it.

Pick Secrets for a new machine with `secrets` / `envSecrets` on `create_machine`, or later with
`set_machine_secrets` followed by `refresh_machine_secrets`. Reads never return values.

Writing or deleting values (`set_secret`, `import_secrets`, `delete_secret`) needs the org
owner/admin API key (`workspace:admin`); a personal org key gets `403 missing_scope`, while the
read and selection tools work with any key. A value you hand to `set_secret` passes through the
chat, so for high-value credentials prefer the InstaBox dashboard or CLI and let the model only
select them.

## Cloudflare Workers configuration

The Worker uses Web Standard APIs and Cloudflare KV. No Node.js server, container, VPS, or
Cloudflare Tunnel is required.

| Setting | Where | Required | Purpose |
|---|---|---:|---|
| `PUBLIC_URL` | Worker environment variable (`.dev.vars` locally; Cloudflare dashboard in production) | yes | Canonical HTTPS origin; MCP resource is `${PUBLIC_URL}/mcp` |
| `AUTH_PASSWORD` | Worker secret | yes | Password for the owner login page |
| `INSTABOX_API_KEY` | Worker secret | yes | InstaBox dashboard API key |
| `MCP_BEARER_TOKEN` | Worker secret | no | Optional static bearer compatibility mode; OAuth is recommended |
| `INSTABOX_API_URL` | `wrangler.jsonc` vars | no | Defaults to `https://api.instabox.sh` |
| `MAX_WAIT_SECONDS` | `wrangler.jsonc` vars | no | Defaults to 45 seconds |
| `OAUTH_KV` | KV binding | yes | Durable OAuth clients, grants, authorization codes and tokens |

`TOKEN_SECRET`, `CIMD_ENABLED`, and `CIMD_ALLOWED_HOSTS` are no longer application settings.
Cloudflare's OAuth Provider manages token signing, storage, DCR, and CIMD metadata fetching.

## Deploy through GitHub (no local deploy CLI)

The production KV namespace is created manually in Cloudflare and its namespace ID is declared
in `wrangler.jsonc`. This is intentional: omitting the ID makes Wrangler attempt to provision a
new namespace, which fails when `instabox-mcp-oauth-kv` already exists. The namespace ID is an
identifier, not an access credential; access is controlled by the Worker binding and Cloudflare
permissions.

1. Push this repository to GitHub.
2. In Cloudflare Dashboard, open **Workers & Pages → Create application → GitHub**, authorize
   GitHub, and select this repository and the `main` branch. If the Worker already exists, open
   **Workers & Pages → instabox-mcp → Settings → Builds** and connect this repository instead.
   Keep the Worker name as `instabox-mcp`.
3. Configure the Workers Builds settings:
   - Build command: `bun run test`
   - Deploy command: `bun run deploy` (runs `wrangler deploy --keep-vars`)
   - Root directory: `/` (repository root)
   - Production branch: `main`
4. In **Workers & Pages → instabox-mcp → Settings → Variables and Secrets**, configure:
   - `PUBLIC_URL` (plain text): the final HTTPS `workers.dev` URL or custom domain, without a
     trailing slash.
   - `AUTH_PASSWORD` (secret): owner login password.
   - `INSTABOX_API_KEY` (secret): InstaBox dashboard API key.
   - `MCP_BEARER_TOKEN` (optional secret): static bearer token, minimum 32 characters.
   - `INSTABOX_API_URL` and `MAX_WAIT_SECONDS` are already configured as non-secret defaults in
     `wrangler.jsonc`.
5. Confirm the existing `OAUTH_KV` namespace is the one referenced by the ID in `wrangler.jsonc`.
   Do not remove or recreate it; it stores OAuth clients, grants, authorization codes and tokens.
6. Save the settings. Every push to `main` now triggers Cloudflare to install dependencies, run
   the build and tests, then deploy the Worker. No local deploy command is needed. The MCP endpoint
   is `${PUBLIC_URL}/mcp`.

The MCP endpoint accepts either an OAuth access token issued by this Worker or, when configured,
`MCP_BEARER_TOKEN`. These are alternative credentials: clients use one method per request.
`INSTABOX_API_KEY` is separate and is only used by the Worker for upstream InstaBox API calls; it
is never an MCP client credential. Static bearer acceptance is a compatibility mode and does not
replace the standard OAuth authorization flow.

Cloudflare Workers Builds uses the Wrangler version declared in `package.json` and deploys on each
push to the connected production branch. Runtime secrets belong in the Cloudflare Dashboard;
the KV namespace ID is kept in `wrangler.jsonc` because Wrangler requires it to bind the existing
namespace. See the [Workers Builds documentation](https://developers.cloudflare.com/workers/ci-cd/builds/).

OAuth data is persisted in KV and survives Worker isolates and deployments. The first deployment
uses the new Cloudflare OAuth storage, so clients authorized by the previous Express server must
sign in again; old custom HMAC tokens cannot be imported into the new provider.

## Local development

Create local secrets and start the Worker on the configured local origin:

```sh
cp .dev.vars.example .dev.vars
# Edit .dev.vars with AUTH_PASSWORD and INSTABOX_API_KEY
node_modules/.bin/wrangler dev --config wrangler.local.jsonc --ip 127.0.0.1 --port 8787
```

Then open `http://localhost:8787/healthz`; the MCP endpoint is
`http://localhost:8787/mcp`. Wrangler uses local KV storage for development.

Run checks separately:

```sh
bun run typecheck
bun run test
```

## Connect a client

The MCP URL is `https://<your-domain>/mcp`. Clients identify themselves automatically and pop up
this server's login page, where you enter `AUTH_PASSWORD`. The page shows the client's name and
where it will send you back to, so check that before you type the password.

Two ways of identifying are supported:

- **Client ID Metadata Documents (CIMD)**, which Claude prefers: the client's `client_id` is an
  HTTPS URL (e.g. `https://claude.ai/oauth/mcp-oauth-client-metadata`). The Cloudflare OAuth
  Provider resolves and validates the document. This Worker enables the
  `global_fetch_strictly_public` compatibility flag for public-network-only metadata fetching.
  Claude Code's loopback callbacks (`http://localhost:<port>/callback` and
  `http://127.0.0.1:<port>/callback`) are accepted by the provider's redirect URI validation.
- **Dynamic client registration (DCR)**, the fallback, used by ChatGPT and older clients.

If Claude's sign-in fails while resolving its client metadata document, inspect the Worker logs
for the OAuth Provider's client-metadata error. DCR remains enabled for clients that use dynamic
registration.

**Claude.ai**: Settings → Connectors → Add custom connector → paste the URL. If asked, choose
**Sign in now** and the **Register** auth client (not Claude identity, not an API key).

**ChatGPT** (Plugins, no developer mode needed):

1. Open [chatgpt.com/plugins](https://chatgpt.com/plugins), select **+**, then **Add custom MCP server**.
2. Name it (e.g. InstaBox) and paste the URL under **Connection**.
3. Authentication: **OAuth**. Leave the client ID and secret empty so ChatGPT registers itself.
4. Tick **I understand and want to continue**, select **Create as a plugin**, and sign in.
5. In a chat, type `@` and pick the plugin. Selection lasts one message, so @mention it again
   for follow-ups that need the machines.

Write tools (create, run, delete...) need a ChatGPT Business or Enterprise/Edu workspace, where
only admins/owners (or RBAC-granted members) can add servers. Pro accounts get read/fetch only,
which leaves this server of little use there. ChatGPT freezes the tool list when the plugin is
created, so after upgrading the server, refresh the tools in workspace app settings (or recreate
the plugin) to pick up new ones.

**Claude Code**: OAuth works as-is (`claude mcp add --transport http instabox https://<your-domain>/mcp`,
then `/mcp` to sign in). If you'd rather skip the browser, set `MCP_BEARER_TOKEN` and pass it as a header:

    claude mcp add --transport http instabox https://<your-domain>/mcp \
      --header "Authorization: Bearer $MCP_BEARER_TOKEN"

**Scripts / curl** (needs `MCP_BEARER_TOKEN`):

    curl -s https://<your-domain>/mcp \
      -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
      -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

## Security notes

- Anyone who logs in can run commands on your machines, so use a long password. Protect the
  authorization endpoint with Cloudflare rate limiting/WAF rules if it is exposed publicly.
- `MCP_BEARER_TOKEN` never expires and skips the login page, so treat it like the password:
  long, random, and rotate it from **Workers & Pages → instabox-mcp → Settings → Variables
  and Secrets** if it leaks. It is compared in constant time. OAuth tokens keep working alongside it.
  This is a compatibility alternative, not an OAuth-issued MCP access token. The MCP authorization
  profile expects server-issued, resource-bound tokens, so use OAuth wherever the client supports it.
- OAuth grants and tokens are stored in KV, not in isolate memory. Keep the KV namespace bound
  across deployments; deleting it revokes all OAuth sessions.
- Production `PUBLIC_URL` must use HTTPS and exactly match the public origin used by clients. Keep it in the Worker environment, not in source control.
