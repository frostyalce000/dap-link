import type { ComponentProps, ReactNode } from "react";

/** Small shared building blocks for the merchant side of the app. */

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <span className="grid size-6 place-items-center rounded-full bg-[conic-gradient(from_0deg,#f2542d,#ff9a5a,#f7c66b,#ff6f91,#f2542d)]">
        <span className="size-2 rounded-full bg-paper" />
      </span>
      DAP Link
    </span>
  );
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-line bg-surface ${className}`}
      {...props}
    />
  );
}

export function Field(props: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={props.htmlFor} className="text-sm font-medium">
        {props.label}
      </label>
      {props.hint && <p className="mt-0.5 text-[13px] text-muted">{props.hint}</p>}
      <div className="mt-1.5">{props.children}</div>
      {props.error && (
        <p className="mt-1.5 text-[13px] text-bad" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}

// 16px text on inputs stops iOS zooming the page on focus.
export const inputClass =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-base outline-none transition placeholder:text-muted focus:border-ink disabled:opacity-60";

export const primaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-paper transition hover:bg-ink-soft active:scale-[0.98] disabled:opacity-50";

export const secondaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-5 text-sm font-semibold transition hover:border-ink active:scale-[0.98] disabled:opacity-50";

export function Badge(props: { tone: "good" | "warn" | "bad" | "neutral" | "accent"; children: ReactNode }) {
  const tones = {
    good: "bg-good-soft text-good",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    neutral: "bg-line text-ink-soft",
    accent: "bg-accent-soft text-accent-ink",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tones[props.tone]}`}
    >
      {props.children}
    </span>
  );
}
