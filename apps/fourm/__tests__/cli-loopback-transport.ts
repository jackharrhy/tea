export function cliLoopbackTransport(
  fetcher: typeof fetch,
  fixtureOrigin: string,
): typeof fetch {
  const fixture = new URL(fixtureOrigin);
  if (
    fixture.origin !== fixtureOrigin ||
    fixture.protocol !== "http:" ||
    fixture.hostname !== "127.0.0.1"
  )
    throw new Error("CLI fixture transport requires exact loopback origin");
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== "https://auth.jackharrhy.dev")
      throw new Error("CLI fixture transport denied outbound destination");
    const mapped = new URL(fixture);
    mapped.pathname = url.pathname;
    mapped.search = url.search;
    return fetcher(
      input instanceof Request ? new Request(mapped, input) : mapped,
      init,
    );
  };
}
