import { describe, expect, it, vi } from "vitest";
import { runProctoringPasses } from "./proctoring";

function logger() { return { info: vi.fn(), error: vi.fn() }; }

describe("worker proctoring passes", () => {
  it("isolates failures and logs only changes", async () => {
    const rpc = vi.fn().mockRejectedValueOnce({ code: "first_failed" }).mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: 2, error: null });
    const log = logger();
    await runProctoringPasses({ rpc } as never, log, new Date(0));
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith("proctoring_changed", { result: "reverse_recent_disconnects", changed: 2 });
  });

  it("suppresses repeated errors, reminds at five minutes and logs recovery", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "db_down", message: "secret database text" } });
    const log = logger();
    await runProctoringPasses({ rpc } as never, log, new Date(0));
    await runProctoringPasses({ rpc } as never, log, new Date(30_000));
    expect(log.error).toHaveBeenCalledTimes(3);
    await runProctoringPasses({ rpc } as never, log, new Date(300_000));
    expect(log.error).toHaveBeenCalledTimes(6);
    rpc.mockResolvedValue({ data: 0, error: null });
    await runProctoringPasses({ rpc } as never, log, new Date(330_000));
    expect(log.info).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("secret database text");
  });
});
