import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResponseTable } from "@/components/dashboard/response-table";
import { Card } from "@/components/ui";
import { requireMerchant } from "@/lib/auth";
import { getOwnedCampaign } from "@/lib/campaigns";
import { listResponses } from "@/lib/dashboard";

export const metadata: Metadata = { title: "Responses" };

const PAGE_LIMIT = 500;

export default async function ResponsesPage(props: PageProps<"/dashboard/campaigns/[id]/responses">) {
  const { id } = await props.params;
  const merchant = await requireMerchant();
  const campaign = await getOwnedCampaign(merchant.id, id);
  if (!campaign) notFound();

  const responses = await listResponses(campaign.id, PAGE_LIMIT);

  return (
    <div>
      <Link
        href={`/dashboard/campaigns/${campaign.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {campaign.productName}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">All responses</h1>
      <p className="mt-1 text-[15px] text-ink-soft">
        {responses.length === PAGE_LIMIT ? `Latest ${PAGE_LIMIT}` : responses.length}{" "}
        {responses.length === 1 ? "response" : "responses"}, newest first.
      </p>
      <Card className="mt-5 px-5 pt-2 pb-3">
        <ResponseTable campaignId={campaign.id} responses={responses} />
      </Card>
    </div>
  );
}
