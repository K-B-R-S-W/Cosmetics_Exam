// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnnouncementToast } from "@/components/candidate/AnnouncementToast";
import { useAnnouncements } from "./useAnnouncements";

const first = { id: "00000000-0000-4000-8000-000000000001", sent_at: "2026-10-07T10:00:00.000Z" };
const second = { id: "00000000-0000-4000-8000-000000000002", sent_at: "2026-10-07T10:00:01.000Z" };
const tokens = ["00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"];

function Host({ announcements, enabled = true, identityKey = "attempt-a", resetKey = 0 }: {
  announcements: typeof first[];
  enabled?: boolean;
  identityKey?: string | null;
  resetKey?: number;
}) {
  const { current } = useAnnouncements(announcements, { enabled, identityKey, resetKey });
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

  it("uses 1/2/4 second backoff and the same token before succeeding on attempt four", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(response(first.id, "Recovered on four"));
    vi.stubGlobal("fetch", fetcher);
    render(<Host announcements={[first]} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const delay of [1_000, 2_000, 4_000]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay); await Promise.resolve(); await Promise.resolve(); });
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(screen.getByText('The exam team says: "Recovered on four"')).toBeTruthy();
    const claimTokens = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).claim_token);
    expect(new Set(claimTokens)).toEqual(new Set([tokens[0]]));
  });

  it("releases the queue after four failures and reuses the stored token on a later heartbeat", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(response(second.id, "Second continues"))
      .mockResolvedValueOnce(response(first.id, "First returns"));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<Host announcements={[first, second]} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    for (const delay of [1_000, 2_000, 4_000]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay); await Promise.resolve(); await Promise.resolve(); });
    }
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(screen.getByText('The exam team says: "Second continues"')).toBeTruthy();

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    view.rerender(<Host announcements={[first]} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(6);
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { claim_token: string });
    expect(bodies[5]!.claim_token).toBe(bodies[0]!.claim_token);
    expect(screen.getByText('The exam team says: "First returns"')).toBeTruthy();
  });

  it("pauses outside eligible routes without forgetting queued ids", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(first.id, "Now eligible"));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<Host announcements={[]} enabled />);
    view.rerender(<Host announcements={[first]} enabled={false} />);
    await act(async () => { await Promise.resolve(); });
    expect(fetcher).not.toHaveBeenCalled();
    view.rerender(<Host announcements={[first]} enabled />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByText('The exam team says: "Now eligible"')).toBeTruthy();
  });

  it("clears all state on reset or identity change and ignores late claim replies", async () => {
    let resolveClaim!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveClaim = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<Host announcements={[first]} resetKey={0} />);
    await act(async () => { await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    view.rerender(<Host announcements={[]} resetKey={1} />);
    await act(async () => { resolveClaim(response(first.id, "Too late")); await Promise.resolve(); });
    expect(screen.queryByText(/Too late/)).toBeNull();

    view.rerender(<Host announcements={[second]} resetKey={1} identityKey="attempt-b" />);
    await act(async () => { await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    view.rerender(<Host announcements={[]} resetKey={1} identityKey="attempt-c" />);
    await act(async () => { resolveClaim(response(second.id, "Wrong candidate")); await Promise.resolve(); });
    expect(screen.queryByText(/Wrong candidate/)).toBeNull();
  });

  it("sets the language from the announcement content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(first.id, "විභාග පණිවිඩය")));
    render(<Host announcements={[first]} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const toast = screen.getByRole("status");
    expect(toast.getAttribute("lang")).toBe("si");
  });

  it("keeps one durable claim through Strict Mode effect replay", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(first.id, "Strict mode message"));
    vi.stubGlobal("fetch", fetcher);
    render(<StrictMode><Host announcements={[first]} /></StrictMode>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByText('The exam team says: "Strict mode message"')).toBeTruthy();
  });
});
