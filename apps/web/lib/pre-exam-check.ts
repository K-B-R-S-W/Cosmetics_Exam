import type { CandidateMediaTrack } from "@/hooks/useLiveKit";

type NavigatorEvidence = {
  userAgent: string;
  maxTouchPoints: number;
  userAgentData?: { brands?: Array<{ brand: string }>; platform?: string };
};

export function isChrome(navigatorEvidence: NavigatorEvidence): boolean {
  const brands = navigatorEvidence.userAgentData?.brands;
  if (brands?.length) return brands.some(({ brand }) => brand === "Google Chrome");
  return /Chrome\//.test(navigatorEvidence.userAgent) && !/(Edg|OPR|SamsungBrowser)\//.test(navigatorEvidence.userAgent);
}

export function isAndroid(navigatorEvidence: NavigatorEvidence): boolean {
  return navigatorEvidence.userAgentData?.platform === "Android" || /Android/i.test(navigatorEvidence.userAgent);
}

export function isDesktopSiteMode(input: NavigatorEvidence & { innerWidth: number; screenWidth: number }): boolean {
  if (input.maxTouchPoints < 1) return false;
  if (isAndroid(input) && input.innerWidth > input.screenWidth) return true;
  return !/(Android|Windows|Macintosh|CrOS)/i.test(input.userAgent);
}

export function hasExtendedScreen(screenEvidence: { isExtended?: boolean }, android: boolean): boolean {
  return !android && screenEvidence.isExtended === true;
}

export function mediaTracksReady(tracks: CandidateMediaTrack[]): boolean {
  const video = tracks.find(({ kind }) => kind === "video")?.track;
  const audio = tracks.find(({ kind }) => kind === "audio")?.track;
  return video?.readyState === "live" && audio?.readyState === "live" && !audio.muted;
}
