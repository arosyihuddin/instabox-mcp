const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export interface StaticBearerIdentity {
  props: { userId: "static-bearer" };
  audience: string;
}

/**
 * Resolve the optional operator-managed bearer token. This is a compatibility path for clients
 * that cannot complete OAuth; OAuth-issued tokens remain handled by OAuthProvider itself.
 */
export async function resolveStaticBearerToken(
  token: string,
  configuredToken: string | undefined,
  audience: string,
): Promise<StaticBearerIdentity | null> {
  if (!configuredToken || !await constantTimeEqual(token, configuredToken)) return null;
  return { props: { userId: "static-bearer" }, audience };
}
