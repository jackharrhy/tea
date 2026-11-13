export async function supportProfile({
  consumer,
  clientId,
  target,
  fetcher = fetch,
}) {
  try {
    const response = await fetcher(
      new URL("/auth/support/eligibility", consumer.origin),
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(2000),
        headers: {
          authorization:
            "Basic " +
            Buffer.from(
              encodeURIComponent(clientId) +
                ":" +
                encodeURIComponent(consumer.transportSecret),
            ).toString("base64"),
          "content-type": "application/json",
        },
        body: JSON.stringify({ targetSubject: target }),
      },
    );
    if (response.status !== 200) return "unavailable";
    let text = "";
    for await (const chunk of response.body) {
      text += Buffer.from(chunk).toString("utf8");
      if (Buffer.byteLength(text) > 1024) {
        await response.body.cancel().catch(() => {});
        return "unavailable";
      }
    }
    const result = JSON.parse(text);
    if (result?.version !== 1 || typeof result.localProfileExists !== "boolean")
      return "unavailable";
    return result.localProfileExists ? "ready" : "missing";
  } catch {
    return "unavailable";
  }
}
