// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ channel: vi.fn(), removeChannel: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserSupabaseClient: () => ({ channel: mocks.channel, removeChannel: mocks.removeChannel }) }));
import { useExamBroadcast } from "./broadcast";

afterEach(() => { cleanup(); mocks.channel.mockReset(); mocks.removeChannel.mockReset(); });

describe("useExamBroadcast", () => {
  it("nudges on subscription and messages, then removes the channel", () => {
    const on = vi.fn();
    const subscribe = vi.fn();
    const channel = { on, subscribe };
    on.mockReturnValue(channel);
    subscribe.mockImplementation((callback: (status: string) => void) => { callback("SUBSCRIBED"); return channel; });
    mocks.channel.mockReturnValue(channel);
    const nudge = vi.fn();
    const { unmount } = renderHook(() => useExamBroadcast("exam-id", nudge));
    expect(mocks.channel).toHaveBeenCalledWith("exam:exam-id");
    expect(nudge).toHaveBeenCalledTimes(1);
    const handler = on.mock.calls[0]?.[2] as () => void;
    handler();
    expect(nudge).toHaveBeenCalledTimes(2);
    unmount();
    expect(mocks.removeChannel).toHaveBeenCalledWith(channel);
  });
});
