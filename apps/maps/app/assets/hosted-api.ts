import { HostedErrorResponseSchema } from "@tea/maps-protocol";

type ResponseSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

export async function readHostedApi<T>(
  path: string,
  schema: ResponseSchema<T>,
): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = HostedErrorResponseSchema.safeParse(payload);
    throw new Error(
      error.success ? error.data.error : `Request failed (${response.status})`,
    );
  }
  const result = schema.safeParse(payload);
  if (!result.success)
    throw new Error("Maps service returned an invalid response");
  return result.data;
}
