"use client";

import { useEffect, useRef } from "react";
import type { VoiceActivity } from "./use-voice-interview";

type Props = {
  activity: VoiceActivity | "connecting";
  /** Returns microphone loudness from 0 to 1. */
  getLevel?: () => number;
};

/**
 * The interviewer's presence on screen. It breathes while waiting, pulses
 * while speaking, and swells with the participant's own voice while they
 * talk, so there is always a visible sign of whose turn it is.
 */
export function Orb({ activity, getLevel }: Props) {
  const haloRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const halo = haloRef.current;
    if (!halo) return;
    if (activity !== "hearing" && activity !== "listening") {
      halo.style.transform = "scale(1)";
      halo.style.opacity = "0";
      return;
    }
    let frame = 0;
    let smoothed = 0;
    const tick = () => {
      const level = getLevel?.() ?? 0;
      smoothed += (level - smoothed) * 0.25;
      halo.style.transform = `scale(${1 + smoothed * 0.55})`;
      halo.style.opacity = String(0.18 + smoothed * 0.5);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activity, getLevel]);

  const motion =
    activity === "speaking"
      ? "animate-orb-speak"
      : activity === "connecting" || activity === "thinking"
        ? "animate-orb-breathe opacity-80"
        : "animate-orb-breathe";

  return (
    <div className="relative grid size-40 place-items-center" aria-hidden="true">
      <div
        ref={haloRef}
        className="absolute inset-0 rounded-full bg-accent opacity-0 blur-xl transition-opacity duration-300"
      />
      <div className={`relative size-32 rounded-full ${motion}`}>
        <div className="absolute inset-0 animate-orb-spin rounded-full bg-[conic-gradient(from_0deg,#f2542d,#ff9a5a,#f7c66b,#ff6f91,#f2542d)]" />
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.75),rgba(255,255,255,0)_55%)]" />
        <div className="absolute inset-0 rounded-full shadow-[inset_0_-10px_24px_rgba(120,30,10,0.28)]" />
      </div>
    </div>
  );
}
