import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startPeriodicUpdateChecks,
  updateCheckIntervalMs,
} from "./update-checks";

afterEach(() => vi.useRealTimers());

describe("periodic update checks", () => {
  it("checks immediately and every 15 minutes until stopped", () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const stop = startPeriodicUpdateChecks(check);

    expect(check).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(updateCheckIntervalMs);
    expect(check).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(updateCheckIntervalMs);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
