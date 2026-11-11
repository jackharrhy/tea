export async function clearStaleExports() {
  if (!navigator.storage?.getDirectory) return;
  try {
    const directory = await navigator.storage.getDirectory();
    const now = Date.now();
    for await (const name of (
      directory as FileSystemDirectoryHandle & {
        keys(): AsyncIterableIterator<string>;
      }
    ).keys()) {
      const match = /^8mb-(\d+)-[\da-f-]+\.tmp$/.exec(name);
      if (match && now - Number(match[1]) > 86400000)
        await directory.removeEntry(name);
    }
  } catch {
    /* Storage may be unavailable in private browsing; small exports still work. */
  }
}
