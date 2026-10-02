import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CampaignForm } from "@/components/dashboard/campaign-form";
import { requireMerchant } from "@/lib/auth";
import { getActiveQuestions, getOwnedCampaign } from "@/lib/campaigns";
import { getAppOrigin } from "@/lib/request";

export const metadata: Metadata = { title: "Edit link" };

export default async function EditCampaignPage(props: PageProps<"/dashboard/campaigns/[id]/edit">) {
  const { id } = await props.params;
  const merchant = await requireMerchant();
  const campaign = await getOwnedCampaign(merchant.id, id);
  if (!campaign) notFound();

  const questions = await getActiveQuestions(campaign.id);
  const host = getAppOrigin(await headers()).replace(/^https?:\/\//, "");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Edit link</h1>
      <CampaignForm
        appHost={host}
        initial={{
          id: campaign.id,
          status: campaign.status,
          productName: campaign.productName,
          productDescription: campaign.productDescription,
          productImageUrl: campaign.productImageUrl,
          slug: campaign.slug,
          questions: questions.map((q) => q.text),
          rewardHeadline: campaign.rewardHeadline,
          rewardKind: campaign.rewardKind,
          rewardCodePrefix: campaign.rewardCodePrefix,
          rewardStaticCode: campaign.rewardStaticCode ?? "",
          rewardInstructions: campaign.rewardInstructions,
        }}
      />
    </div>
  );
}
