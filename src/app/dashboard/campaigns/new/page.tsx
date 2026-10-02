import type { Metadata } from "next";
import { headers } from "next/headers";
import { CampaignForm, EMPTY_CAMPAIGN } from "@/components/dashboard/campaign-form";
import { requireMerchant } from "@/lib/auth";
import { getAppOrigin } from "@/lib/request";

export const metadata: Metadata = { title: "New link" };

export default async function NewCampaignPage() {
  await requireMerchant();
  const host = getAppOrigin(await headers()).replace(/^https?:\/\//, "");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">New link</h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-soft">
        Four short steps. You can change everything later.
      </p>
      <CampaignForm initial={EMPTY_CAMPAIGN} appHost={host} />
    </div>
  );
}
