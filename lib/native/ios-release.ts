export function hasNewerIOSRelease(installed: string, published: string): boolean {
  const versionPattern = /^\d+(\.\d+){0,2}$/;
  if (!versionPattern.test(installed) || !versionPattern.test(published)) return false;

  const current = installed.split(".").map(Number);
  const latest = published.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (latest[i] ?? 0) - (current[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}
