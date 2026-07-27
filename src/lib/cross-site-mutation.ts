const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type HeaderReader = {
  get(name: string): string | null;
};

export type MutationRequestLike = {
  method: string;
  headers: HeaderReader;
  nextUrl: {
    origin: string;
    pathname: string;
  };
};

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function normalizedHost(value: string | null) {
  const host = firstHeaderValue(value)?.toLowerCase();
  if (!host || /[\s/@\\?#]/.test(host)) return null;
  try {
    return new URL(`https://${host}`).host.toLowerCase();
  } catch {
    return null;
  }
}

function trustedRequestOrigins(request: MutationRequestLike) {
  const trusted = new Set<string>();

  try {
    trusted.add(new URL(request.nextUrl.origin).origin);
  } catch {
    // A malformed internal URL should not prevent validation against proxy headers.
  }

  const forwardedHost = normalizedHost(request.headers.get("x-forwarded-host"));
  const requestHost = normalizedHost(request.headers.get("host"));
  const forwardedProtocol = firstHeaderValue(request.headers.get("x-forwarded-proto"))?.toLowerCase();
  const protocols = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? [forwardedProtocol]
    : ["https", "http"];

  for (const host of [forwardedHost, requestHost]) {
    if (!host) continue;
    for (const protocol of protocols) {
      trusted.add(`${protocol}://${host}`);
    }
  }

  return trusted;
}

export function isCrossSiteMutation(request: MutationRequestLike) {
  if (
    !MUTATION_METHODS.has(request.method.toUpperCase())
    || !request.nextUrl.pathname.startsWith("/api/")
  ) {
    return false;
  }

  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return true;
  }

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return !trustedRequestOrigins(request).has(new URL(origin).origin);
  } catch {
    return true;
  }
}
