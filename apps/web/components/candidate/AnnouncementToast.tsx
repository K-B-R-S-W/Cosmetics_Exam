"use client";

import type { StateBody } from "@/lib/candidate-types";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import type { DisplayAnnouncement } from "@/hooks/useAnnouncements";

export function AnnouncementToast({ announcement }: { announcement: DisplayAnnouncement | null }) {
  if (!announcement) return null;
  return (
    <div className="fixed right-4 top-20 z-40 max-h-[min(50dvh,24rem)] w-[min(28rem,calc(100vw-2rem))] overflow-auto rounded-control border border-ink bg-paper p-4 text-ink shadow-lg" role="status">
      The exam team says: &quot;{announcement.message}&quot;
    </div>
  );
}

export function CandidateAnnouncements({ announcements }: { announcements: StateBody["announcements"] }) {
  return <AnnouncementToast announcement={useAnnouncements(announcements)} />;
}
