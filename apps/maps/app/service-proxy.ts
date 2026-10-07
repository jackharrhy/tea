export function isServicePath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/auth/");
}

export function isCollaborationPath(pathname: string): boolean {
  return /^\/sync\/maps\/[^/]+\/(?:snapshot|live|initialize|checkpoints|source)$/.test(
    pathname,
  );
}

export async function proxyServiceRequest(
  request: Request,
  serviceOrigin: string,
  fetcher: (request: Request) => Promise<Response> = fetch,
): Promise<Response> {
  const incoming = new URL(request.url);
  if (!isServicePath(incoming.pathname)) {
    return new Response("Not found", { status: 404 });
  }

  return proxyRequest(
    request,
    serviceOrigin,
    "Maps service is unavailable",
    fetcher,
  );
}

export async function proxyCollaborationRequest(
  request: Request,
  collaborationOrigin: string,
  fetcher: (request: Request) => Promise<Response> = fetch,
): Promise<Response> {
  if (!isCollaborationPath(new URL(request.url).pathname)) {
    return new Response("Not found", { status: 404 });
  }

  return proxyRequest(
    request,
    collaborationOrigin,
    "Maps collaboration is unavailable",
    fetcher,
  );
}

async function proxyRequest(
  request: Request,
  origin: string,
  unavailableMessage: string,
  fetcher: (request: Request) => Promise<Response>,
): Promise<Response> {
  const incoming = new URL(request.url);
  const destination = new URL(origin);
  destination.pathname = incoming.pathname;
  destination.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  const upstream = new Request(destination, {
    method: request.method,
    headers,
    body: request.body,
    duplex: request.body ? "half" : undefined,
    redirect: "manual",
  } as RequestInit);
  try {
    return await fetcher(upstream);
  } catch {
    return new Response(JSON.stringify({ error: unavailableMessage }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
