// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnnouncementToast } from "@/components/candidate/AnnouncementToast";
import { useAnnouncements } from "./useAnnouncements";

const first = { id: "00000000-0000-4000-8000-000000000001", sent_at: "2026-10-07T10:00:00.000Z" };
const second = { id: "00000000-0000-4000-8000-000000000002", sent_at: "2026-10-07T10:00:01.000Z" };
const tokens = ["00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"];

function Host({ announcements }: { announcements: typeof first[] }) {
  const current = useAnnouncements(announcements);
  return <AnnouncementToast announcement={current} />;
}

function response(id: string, message: string) {
  return new Response(JSON.stringify({ display: true, announcement: { id, message, sent_at: "2026-10-07T10:00:00.000Z" } }), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValueOnce(tokens[0]!).mockReturnValueOnce(tokens[1]!);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("candidate announcements", () => {
  it("shows FIFO plain-text toasts for five seconds with a one-second empty gap and de-dupes while showing", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(first.id, '<script>alert("x")</script>'))
      .mockResolvedValueOnce(response(second.id, "Second message"));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<Host announcements={[second, first]} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const firstToast = screen.getByRole("status");
    expect(firstToast.textContent).toContain('<script>alert("x")</script>');
    expect(firstToast.querySelector("script")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    view.rerender(<Host announcements={[first, second, first]} />);
    await act(async () => { await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.queryByRole("status")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('The exam team says: "Second message"')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { claim_token: string });
    expect(bodies.map(({ claim_token }) => claim_token)).toEqual(tokens);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("retries a lost reply with the same claim token", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("lost reply")).mockResolvedValueOnce(response(first.id, "Recovered"));
    vi.stubGlobal("fetch", fetcher);
    render(<Host announcements={[first]} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText('The exam team says: "Recovered"')).toBeTruthy();
    const claims = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { claim_token: string });
    expect(claims[0]?.claim_token).toBe(claims[1]?.claim_token);
  });

  it("does not render a toast when the durable claim says this candidate may not display it", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ display: false }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    render(<Host announcements={[first]} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
