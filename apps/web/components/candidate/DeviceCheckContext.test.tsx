// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DeviceCheckProvider, useDeviceCheck } from "./DeviceCheckContext";

afterEach(cleanup);
const wrapper = ({ children }: { children: ReactNode }) => <DeviceCheckProvider>{children}</DeviceCheckProvider>;

describe("DeviceCheckProvider", () => {
  it("re-requests a wanted wake lock when the page becomes visible", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const first = { released: false, release };
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValue({ released: false, release });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    const hook = renderHook(() => useDeviceCheck(), { wrapper });
    await act(async () => { await hook.result.current.requestWakeLock(); });
    first.released = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await act(async () => { await hook.result.current.releaseDeviceCheck(); });
    expect(release).toHaveBeenCalledOnce();
  });

  it("release is idempotent", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: vi.fn().mockResolvedValue({ released: false, release }) } });
    const hook = renderHook(() => useDeviceCheck(), { wrapper });
    await act(async () => { await hook.result.current.requestWakeLock(); await hook.result.current.releaseDeviceCheck(); await hook.result.current.releaseDeviceCheck(); });
    expect(release).toHaveBeenCalledOnce();
  });
});
