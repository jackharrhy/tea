export function formatProgress(progress: {
  current: number;
  total: number;
  message: string;
}): string {
  if (progress.total <= 0) return progress.message;
  const fraction = Math.max(0, Math.min(1, progress.current / progress.total));
  const filled = Math.round(fraction * 20);
  return `[${"=".repeat(filled)}${" ".repeat(20 - filled)}] ${Math.floor(fraction * 100)}% ${progress.message}`;
}
