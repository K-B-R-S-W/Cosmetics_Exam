import { describe, expect, it } from "vitest";
import { hasExtendedScreen, isChrome, isDesktopSiteMode, mediaTracksReady } from "./pre-exam-check";

const navigatorEvidence = { userAgent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36", maxTouchPoints: 0 };

describe("pre-exam checks", () => {
  it("uses UA-CH first and a strict Chrome fallback", () => {
    expect(isChrome({ ...navigatorEvidence, userAgentData: { brands: [{ brand: "Google Chrome" }] } })).toBe(true);
    expect(isChrome({ ...navigatorEvidence, userAgentData: { brands: [{ brand: "Microsoft Edge" }] } })).toBe(false);
    expect(isChrome(navigatorEvidence)).toBe(true);
    expect(isChrome({ ...navigatorEvidence, userAgent: "Mozilla/5.0 Edg/140 Chrome/140" })).toBe(false);
  });

  it("detects Android desktop-site evidence without flagging touch laptops", () => {
    expect(isDesktopSiteMode({ userAgent: "Mozilla/5.0 (Linux; Android 14)", maxTouchPoints: 5, innerWidth: 1100, screenWidth: 800 })).toBe(true);
    expect(isDesktopSiteMode({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/140", maxTouchPoints: 5, innerWidth: 800, screenWidth: 800 })).toBe(true);
    expect(isDesktopSiteMode({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140", maxTouchPoints: 10, innerWidth: 1200, screenWidth: 800 })).toBe(false);
  });

  it("treats a second screen as a desktop-only warning", () => {
    expect(hasExtendedScreen({ isExtended: true }, false)).toBe(true);
    expect(hasExtendedScreen({ isExtended: true }, true)).toBe(false);
  });

  it("requires live video and live unmuted audio", () => {
    const track = (kind: "audio" | "video", readyState: MediaStreamTrackState, muted = false) => ({ kind, source: "track" as const, track: { readyState, muted } as MediaStreamTrack });
    expect(mediaTracksReady([track("video", "live"), track("audio", "live")])).toBe(true);
    expect(mediaTracksReady([track("video", "live"), track("audio", "live", true)])).toBe(false);
  });
});
