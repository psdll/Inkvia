import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bootstrapMocks = vi.hoisted(() => ({
  backgroundJobsAllowed: vi.fn(),
}));

vi.mock("@/lib/maintenance", () => ({
  backgroundJobsAllowed: bootstrapMocks.backgroundJobsAllowed,
}));

vi.mock("@/lib/prisma", () => ({
  default: {},
}));

describe("background job bootstrap during maintenance", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    bootstrapMocks.backgroundJobsAllowed.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("retries bootstrap and schedules jobs after maintenance clears", async () => {
    bootstrapMocks.backgroundJobsAllowed
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { startBackgroundJobs } = await import("@/lib/server-bootstrap");

    startBackgroundJobs();

    expect(bootstrapMocks.backgroundJobsAllowed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("background jobs scheduled"));

    await vi.advanceTimersByTimeAsync(2_000);

    expect(bootstrapMocks.backgroundJobsAllowed).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBeGreaterThan(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("background jobs scheduled"));
    log.mockRestore();
  });
});
