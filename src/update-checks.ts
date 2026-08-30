export const updateCheckIntervalMs = 15 * 60 * 1000;

export function startPeriodicUpdateChecks(check: () => void) {
  check();
  const interval = window.setInterval(check, updateCheckIntervalMs);
  return () => window.clearInterval(interval);
}
