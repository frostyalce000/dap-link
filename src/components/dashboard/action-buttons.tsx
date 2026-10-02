"use client";

import { Pause, Play, RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { refreshInsights, setCampaignStatus } from "@/app/dashboard/actions";
import { secondaryButtonClass } from "@/components/ui";

export function StatusButton({ campaignId, status }: { campaignId: string; status: "draft" | "published" | "paused" }) {
  const [pending, start] = useTransition();
  const next = status === "published" ? "paused" : "published";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => setCampaignStatus(campaignId, next))}
      className={secondaryButtonClass}
    >
      {status === "published" ? (
        <Pause className="size-4" aria-hidden="true" />
      ) : (
        <Play className="size-4" aria-hidden="true" />
      )}
      {pending ? "Saving…" : status === "published" ? "Pause" : status === "paused" ? "Resume" : "Publish"}
    </button>
  );
}

export function RefreshInsightsButton({ campaignId }: { campaignId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => refreshInsights(campaignId))}
      className="inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline disabled:opacity-50"
    >
      <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
      {pending ? "Analysing…" : "Refresh"}
    </button>
  );
}
