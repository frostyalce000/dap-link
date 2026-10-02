import type { ReactNode } from "react";
import { formatPercent } from "@/lib/format";

/**
 * Chart colours. Marks carry the colour; every label and number beside them
 * stays in ink, so nothing is identified by colour alone.
 *
 * - Sentiment is categorical: three hues that stay distinct for colour-blind
 *   readers, plus a recessive grey for "neutral".
 * - Purchase intent and price sensitivity are ordered, so they share one blue
 *   ramp (darker means more) with the same grey for "not enough signal".
 */
export const CHART_COLORS = {
  sentiment: { positive: "#2a78d6", mixed: "#eda100", neutral: "#c9c6bc", negative: "#e34948" },
  level: { high: "#184f95", medium: "#3987e5", low: "#86b6ef", unclear: "#c9c6bc" },
  bar: "#3987e5",
} as const;

export type Segment = { key: string; label: string; value: number; color: string };

/**
 * A single horizontal part-to-whole bar with a legend that doubles as the
 * table view: every segment's count and share is written out beneath it.
 */
export function ShareBar({ segments, emptyLabel }: { segments: Segment[]; emptyLabel: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) return <p className="text-sm text-muted">{emptyLabel}</p>;
  const visible = segments.filter((segment) => segment.value > 0);

  return (
    <div>
      <div className="flex h-3 w-full gap-0.5" role="img" aria-label={visible.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        {visible.map((segment, index) => (
          <div
            key={segment.key}
            title={`${segment.label}: ${segment.value} (${formatPercent(segment.value / total)})`}
            style={{ flexGrow: segment.value, backgroundColor: segment.color }}
            className={`min-w-1 basis-0 ${index === 0 ? "rounded-l" : ""} ${index === visible.length - 1 ? "rounded-r" : ""}`}
          />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} aria-hidden="true" />
            <dt className="text-ink-soft">{segment.label}</dt>
            <dd className="ml-auto tabular-nums">
              <span className="font-semibold">{segment.value}</span>
              <span className="ml-1.5 text-muted">{formatPercent(segment.value / total)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Ranked horizontal bars for a short list, with the value written at the end. */
export function BarList({ items, emptyLabel }: { items: { label: string; count: number }[]; emptyLabel: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{emptyLabel}</p>;
  const max = Math.max(...items.map((item) => item.count));
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} title={`${item.label}: ${item.count}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink-soft">{item.label}</span>
            <span className="font-semibold tabular-nums">{item.count}</span>
          </div>
          <div className="mt-1 h-2 w-full rounded-r bg-line/60">
            <div
              className="h-full rounded-r"
              style={{ width: `${Math.max(2, (item.count / max) * 100)}%`, backgroundColor: CHART_COLORS.bar }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StatTile(props: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <p className="text-[13px] text-muted">{props.label}</p>
      <p className="mt-1 text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums">{props.value}</p>
      {props.note && <p className="mt-1.5 text-[13px] text-muted">{props.note}</p>}
    </div>
  );
}
