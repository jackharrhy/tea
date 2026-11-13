interface ReviewBindings {
  FOURM: Fetcher;
  WORLD: Fetcher;
}
export default {
  async fetch(request: Request, env: ReviewBindings) {
    if (new URL(request.url).pathname.startsWith("/world/")) {
      const headers = new Headers(request.headers);
      headers.delete("Cookie");
      headers.delete("Authorization");
      return env.WORLD.fetch(
        new Request(request, { headers, redirect: "manual" }),
      );
    }
    return env.FOURM.fetch(new Request(request, { redirect: "manual" }));
  },
} satisfies ExportedHandler<ReviewBindings>;
