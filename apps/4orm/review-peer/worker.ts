interface PeerBindings {
  COMMUNITY_PUBLIC: { listPublicMembers(): Promise<unknown> };
}
export default {
  async fetch(request: Request, env: PeerBindings) {
    if (request.method !== "GET")
      return new Response("Read-only public directory", {
        status: 405,
        headers: { Allow: "GET" },
      });
    if (new URL(request.url).pathname === "/world/binding-check")
      return Response.json({
        databaseBinding: "COMMUNITIES" in env,
        mediaBinding: "MEDIA" in env,
        enrollmentKey: "AUTH_ENROLLMENT_KEY" in env,
        cookieReceived: request.headers.has("Cookie"),
        authorizationReceived: request.headers.has("Authorization"),
      });
    if (new URL(request.url).pathname !== "/world/community")
      return new Response("Not found", { status: 404 });
    return Response.json({
      application: "fourm",
      members: await env.COMMUNITY_PUBLIC.listPublicMembers(),
    });
  },
} satisfies ExportedHandler<PeerBindings>;
