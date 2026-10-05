import { badgeTone } from "@/lib/violation-events";

export function CandidateBadge({
  merCode,
  count,
  threshold,
}: {
  merCode: string;
  count: number;
  threshold: number;
}) {
  const tone = badgeTone(count, threshold);
  const noun = count === 1 ? "violation" : "violations";
  const className =
    tone === "red"
      ? "text-alert"
      : tone === "amber"
        ? "text-warn"
        : "text-muted";

  return (
    <span
      className={className}
      aria-label={`${merCode}, ${count} ${noun}${tone === "red" ? ", flagged" : tone === "amber" ? ", warning" : ""}`}
    >
      <span aria-hidden="true">
        {tone === "red" ? "! " : tone === "amber" ? "▲ " : ""}
      </span>
      {count} {noun}
      {tone === "red" ? " · Flagged" : ""}
    </span>
  );
}
