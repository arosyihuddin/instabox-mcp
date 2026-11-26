import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import OAuthProvider, { type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env as workerEnv } from "cloudflare:workers";
import { configureRuntime } from "./config.js";
import { registerTools } from "./tools.js";
import { registerSecretTools } from "./secrets.js";
import { registerDesktopTools } from "./desktop.js";

interface Env {
  PUBLIC_URL: string;
  AUTH_PASSWORD: string;
  INSTABOX_API_KEY: string;
  INSTABOX_API_URL?: string;
  MCP_BEARER_TOKEN?: string;
  MAX_WAIT_SECONDS?: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
}

const VERSION = "0.5.0";
const encoder = new TextEncoder();
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function page(details: { clientName: string; clientDomain?: string; redirectHost: string; redirectIsLoopback: boolean; scope: string[] }, handle: string): string {
  const scopes = details.scope.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("");
  const domain = details.clientDomain ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.` : "The application name is self-reported.";
  const localWarning = details.redirectIsLoopback ? "<p class=warning>This redirects to a local application on your device. Continue only if you initiated this login.</p>" : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>InstaBox MCP · Sign in</title>
<style>body{font:15px system-ui,sans-serif;background:#09090b;color:#fafafa;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:#18181b;border:1px solid #27272a;border-radius:14px;padding:28px;width:min(380px,calc(100% - 56px))}h1{font-size:20px;margin:0 0 8px}p,li{color:#a1a1aa;line-height:1.5}ul{padding-left:20px}.warning,.error{color:#f87171}input{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;border:1px solid #3f3f46;background:#09090b;color:white;font:inherit}button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:8px;background:#fafafa;color:#09090b;font-weight:650;font:inherit;cursor:pointer}.error{font-size:13px}</style></head><body><main class=card><h1>InstaBox MCP</h1><p><strong>${escapeHtml(details.clientName)}</strong> wants access to your InstaBox account.</p><p>${domain} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>${localWarning}<p>Requested permissions:</p><ul>${scopes}</ul><form method=post action=/authorize><input type=hidden name=handle value="${escapeHtml(handle)}"><label for=password>Account password</label><input id=password type=password name=password autocomplete=current-password autofocus required><button name=decision value=approve>Allow access</button><button name=decision value=deny formnovalidate>Deny</button></form></main></body></html>`;
}

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") {
      return Response.json({ ok: true, version: VERSION });
    }
    if (url.pathname !== "/authorize") return new Response("Not found", { status: 404 });

    const oauth = env.OAUTH_PROVIDER;
    if (request.method === "GET") {
      try {
        const authRequest = await oauth.parseAuthRequest(request);
        const details = await oauth.describeConsent(authRequest);
        const consent = await oauth.beginConsent(authRequest);
        const headers = new Headers(consent.headers);
        headers.set("Content-Type", "text/html; charset=utf-8");
        headers.set("Cache-Control", "no-store");
        return new Response(page(details, consent.handle), { headers });
      } catch (error) {
        console.error("OAuth authorization request failed", error);
        return new Response("Invalid authorization request. Return to your MCP client and try again.", { status: 400 });
      }
    }

    if (request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") || "");
      const decision = String(form.get("decision") || "approve");
      if (decision === "deny") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const password = String(form.get("password") || "");
      if (!await constantTimeEqual(password, env.AUTH_PASSWORD)) {
        return new Response("Wrong password. Go back to the authorization page and try again.", {
          status: 401,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      const approved = await oauth.approveConsent(request, handle);
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: "instabox-owner",
        metadata: {},
        scope: approved.request.scope,
        props: { userId: "instabox-owner" },
      });
      const headers = new Headers(approved.headers);
      headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers });
    }

    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  },
};

const mcpHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    configureRuntime(env);
    if (request.method !== "POST") {
      return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, {
        status: 405,
        headers: { Allow: "POST", "Content-Type": "application/json" },
      });
    }

    const server = new McpServer({ name: "instabox", version: VERSION });
    registerTools(server);
    registerSecretTools(server);
    registerDesktopTools(server);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 4 * 1024 * 1024 });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      await transport.close();
      await server.close();
      return response;
    } catch (error) {
      console.error("MCP request failed", error);
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }, { status: 500 });
    }
  },
};

const publicUrl = (workerEnv as unknown as Env).PUBLIC_URL.replace(/\/$/, "");
const publicUrlObject = new URL(publicUrl);
if (publicUrlObject.pathname !== "/" || publicUrlObject.search || publicUrlObject.hash || publicUrlObject.username || publicUrlObject.password) {
  throw new Error("PUBLIC_URL must be an origin only, without a path, query, or fragment");
}
const provider = new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  accessTokenTTL: 3600,
  refreshTokenTTL: 60 * 60 * 24 * 30,
  scopesSupported: ["mcp", "offline_access"],
  requiredScopes: ["mcp"],
  clientIdMetadataDocumentEnabled: true,
  resourceMetadata: {
    resource: `${publicUrl}/mcp`,
    authorization_servers: [publicUrl],
    bearer_methods_supported: ["header"],
    resource_name: "InstaBox MCP",
  },
  resolveExternalToken: async ({ token, env }) => {
    if (!env.MCP_BEARER_TOKEN || !await constantTimeEqual(token, env.MCP_BEARER_TOKEN)) return null;
    return { props: { userId: "static-bearer" }, audience: `${publicUrl}/mcp` };
  },
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    configureRuntime(env);
    const configuredUrl = new URL(env.PUBLIC_URL).origin;
    if (new URL(request.url).origin !== configuredUrl) {
      return new Response("Invalid host", { status: 421 });
    }
    return provider.fetch(request, env, ctx);
  },
};
