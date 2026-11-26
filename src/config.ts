export interface RuntimeConfig {
  publicUrl: string;
  instaboxApiKey: string;
  instaboxApiUrl: string;
  maxWaitSeconds: number;
}

let runtimeConfig: RuntimeConfig | undefined;

export function configureRuntime(env: { PUBLIC_URL: string; AUTH_PASSWORD: string; INSTABOX_API_KEY: string; INSTABOX_API_URL?: string; MCP_BEARER_TOKEN?: string; MAX_WAIT_SECONDS?: string }): RuntimeConfig {
  const publicUrl = env.PUBLIC_URL.replace(/\/$/, "");
  const parsed = new URL(publicUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("PUBLIC_URL must use HTTPS outside localhost");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("PUBLIC_URL must be an origin only, without a path, query, or fragment");
  }
  if (!env.AUTH_PASSWORD) throw new Error("Missing required secret AUTH_PASSWORD");
  if (!env.INSTABOX_API_KEY) throw new Error("Missing required secret INSTABOX_API_KEY");
  if (env.MCP_BEARER_TOKEN && env.MCP_BEARER_TOKEN.length < 32) {
    throw new Error("MCP_BEARER_TOKEN must be at least 32 characters");
  }
  runtimeConfig = {
    publicUrl,
    instaboxApiKey: env.INSTABOX_API_KEY,
    instaboxApiUrl: (env.INSTABOX_API_URL || "https://api.instabox.sh").replace(/\/$/, ""),
    maxWaitSeconds: Number(env.MAX_WAIT_SECONDS || 45),
  };
  return runtimeConfig;
}

export function getConfig(): RuntimeConfig {
  if (!runtimeConfig) throw new Error("Worker runtime has not been configured");
  return runtimeConfig;
}
