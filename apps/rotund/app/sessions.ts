import { createMemorySessionStorage } from "remix/session-storage/memory";
import type { SessionStorage } from "remix/session";

export function boundedSessions(
  limit = 5000,
  lifetime = 3600000,
  now = Date.now,
): SessionStorage {
  const backend = createMemorySessionStorage();
  const expiry = new Map<string, number>();
  async function remove(key: string) {
    const value = await backend.read(key);
    value.destroy();
    await backend.save(value);
    expiry.delete(key);
  }
  return {
    async read(value) {
      if (value && (expiry.get(value) ?? 0) <= now()) await remove(value);
      return backend.read(value);
    },
    async save(value) {
      const key = await backend.save(value);
      if (key) {
        for (const [old, expires] of expiry)
          if (expires <= now()) await remove(old);
        expiry.delete(key);
        expiry.set(key, now() + lifetime);
        while (expiry.size > limit) await remove(expiry.keys().next().value!);
      }
      return key;
    },
  };
}
