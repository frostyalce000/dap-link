import { Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge, Card, primaryButtonClass } from "@/components/ui";
import { requireMerchant } from "@/lib/auth";
import { listCampaigns } from "@/lib/dashboard";

const STATUS = {
  published: { label: "Live", tone: "good" },
  draft: { label: "Draft", tone: "neutral" },
  paused: { label: "Paused", tone: "warn" },
} as const;

export default async function DashboardPage() {
  const merchant = await requireMerchant();
  const campaigns = await listCampaigns(merchant.id);

  if (campaigns.length === 0) {
    return (
      <Card className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Create your first DAP Link</h1>
        <p className="mt-2 text-[15px] leading-snug text-ink-soft">
          Pick a product, choose three questions and a reward. You&apos;ll get one link to share
          anywhere your audience is.
        </p>
        <Link href="/dashboard/campaigns/new" className={`${primaryButtonClass} mt-5`}>
          <Plus className="size-4" aria-hidden="true" />
          New link
        </Link>
      </Card>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your links</h1>
        <Link href="/dashboard/campaigns/new" className={primaryButtonClass}>
          <Plus className="size-4" aria-hidden="true" />
          New link
        </Link>
      </div>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {campaigns.map((campaign) => (
          <li key={campaign.id}>
            <Link
              href={`/dashboard/campaigns/${campaign.id}`}
              className="flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-ink"
            >
              <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-paper">
                {campaign.productImageUrl && (
                  <Image src={campaign.productImageUrl} alt="" fill sizes="64px" className="object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold">{campaign.productName}</p>
                  <Badge tone={STATUS[campaign.status].tone}>{STATUS[campaign.status].label}</Badge>
                </div>
                <p className="mt-0.5 truncate font-mono text-[13px] text-muted">/{campaign.slug}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  <span className="font-semibold tabular-nums">{campaign.responses}</span>{" "}
                  {campaign.responses === 1 ? "response" : "responses"}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
