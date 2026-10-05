"use client";
import { Button } from "@/components/ui/Button";

export async function enterExamFullscreen(element: HTMLElement = document.documentElement): Promise<void> {
  await element.requestFullscreen();
  const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> };
  if (orientation.lock) await orientation.lock(orientation.type).catch(() => undefined);
}

export function unlockExamOrientation(): void {
  screen.orientation?.unlock?.();
}

export function FullscreenOverlay({ active, onRestore = enterExamFullscreen }: { active: boolean; onRestore?: () => Promise<void> }) {
  if (!active) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface p-6" role="alertdialog" aria-modal="true" aria-labelledby="fullscreen-title">
    <section className="max-w-md text-center"><h2 id="fullscreen-title" className="text-title font-bold">Return to fullscreen</h2><p className="mt-3 text-muted">The exam stays paused on this screen until fullscreen is restored.</p><Button className="mt-6" onClick={() => void onRestore()}>Return to fullscreen</Button></section>
  </div>;
}
