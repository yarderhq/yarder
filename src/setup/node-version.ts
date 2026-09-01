export const MIN_NODE_MAJOR = 22;

export function nodeMeetsEngine(version: string, minMajor = MIN_NODE_MAJOR): boolean {
  const match = version.trim().replace(/^v/i, "").match(/^(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  return Number.isFinite(major) && major >= minMajor;
}
