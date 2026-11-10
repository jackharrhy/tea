import { updateControlPort, updateDrainReceipt } from "./update-control";

export async function preUpdate(
  port = updateControlPort(),
  operation: "drain" | "resume" = "drain",
): Promise<0 | 75> {
  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 75;
    const response = await fetch(`http://127.0.0.1:${port}/${operation}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (response.status !== 200) return 75;
    const data = await response.json();
    if (operation === "drain")
      return updateDrainReceipt.safeParse(data).success ? 0 : 75;
    return data?.version === 1 && data?.state === "open" ? 0 : 75;
  } catch {
    return 75;
  }
}

if (import.meta.main) {
  const operation = process.argv[2] ?? "drain";
  const code =
    operation === "drain" || operation === "resume"
      ? await preUpdate(undefined, operation)
      : 75;
  console.log(
    code === 0
      ? `Update control: ${operation} confirmed.`
      : "Update deferred: busy or unconfirmed control response.",
  );
  process.exitCode = code;
}
