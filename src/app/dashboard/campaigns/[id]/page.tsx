import { ArrowLeft, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { RefreshInsightsButton, StatusButton } from "@/components/dashboard/action-buttons";
import { BarList, CHART_COLORS, ShareBar, StatTile } from "@/components/dashboard/charts";
import { ResponseTable } from "@/components/dashboard/response-table";
import { ShareLink } from "@/components/dashboard/share-link";
import { Badge, Card, secondaryButtonClass } from "@/components/ui";
import { analyzePendingSessions } from "@/lib/analysis/analyze-session";
import { refreshCampaignInsightsIfStale, type StoredTheme } from "@/lib/analysis/synthesize-campaign";
import { requireMerchant } from "@/lib/auth";
import { getActiveQuestions, getOwnedCampaign } from "@/lib/campaigns";
import { getCampaignInsights, getCampaignOverview, listResponses } from "@/lib/dashboard";
import { formatDuration, formatMoney, formatPercent } from "@/lib/format";
import { getAppOrigin } from "@/lib/request";
import { deliverPendingRewardEmails } from "@/lib/reward-email";

export const metadata: Metadata = { title: "Campaign" };
export const maxDuration = 60;

const STATUS = {
  published: { label: "Live", tone: "good" },
  draft: { label: "Draft", tone: "neutral" },
  paused: { label: "Paused", tone: "warn" },
} as const;

const RECENT_RESPONSES = 8;

export default async function CampaignPage(props: PageProps<"/dashboard/campaigns/[id]">) {
  const { id } = await props.params;
  const { published } = await props.searchParams;
  const merchant = await requireMerchant();
  const campaign = await getOwnedCampaign(merchant.id, id);
  if (!campaign) notFound();

  const [overview, insights, responses, questions, requestHeaders] = await Promise.all([
    getCampaignOverview(campaign.id),
    getCampaignInsights(campaign.id),
    listResponses(campaign.id, RECENT_RESPONSES),
    getActiveQuestions(campaign.id),
    headers(),
  ]);

  // Self-healing: anything that failed in the background (an analysis, the
  // summary, a reward email) is retried after this page has been sent. The
  // next visit shows the result.
  after(async () => {
    if (overview.awaitingAnalysis > 0 || (insights?.sessionsIncluded ?? 0) < overview.analysed) {
      await analyzePendingSessions(campaign.id);
      await refreshCampaignInsightsIfStale(campaign.id);
    }
    await deliverPendingRewardEmails(campaign.id, 20);
  });

  const url = `${getAppOrigin(requestHeaders)}/${campaign.slug}`;
  const analysed = overview.analysed;
  const highIntent = analysed > 0 ? overview.purchaseIntent.high / analysed : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden="true" />
          All links
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.productName}</h1>
          <Badge tone={STATUS[campaign.status].tone}>{STATUS[campaign.status].label}</Badge>
          <div className="ml-auto flex gap-2">
            <StatusButton campaignId={campaign.id} status={campaign.status} />
            <Link href={`/dashboard/campaigns/${campaign.id}/edit`} className={secondaryButtonClass}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Link>
          </div>
        </div>
      </div>

      <Card className="p-5">
        {published === "1" && (
          <p className="mb-3 rounded-xl bg-good-soft px-3.5 py-2.5 text-sm font-medium text-good">
            Your link is live. Share it anywhere: your bio, a story, an email, a text.
          </p>
        )}
        {campaign.status !== "published" && (
          <p className="mb-3 rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
            {campaign.status === "draft"
              ? "This link is a draft. Publish it before you share it."
              : "This link is paused and isn't accepting responses."}
          </p>
        )}
        <ShareLink url={url} live={campaign.status === "published"} />
        <p className="mt-3 text-[13px] text-muted">
          {questions.length} {questions.length === 1 ? "question" : "questions"} · Reward:{" "}
          {campaign.rewardHeadline} · Add <span className="font-mono">?src=instagram</span> to the link to
          see where responses come from.
        </p>
      </Card>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Responses" value={String(overview.responses)} note={`${overview.started} started`} />
        <StatTile
          label="Completion rate"
          value={formatPercent(overview.completionRate)}
          note="of people who started"
        />
        <StatTile
          label="Average time"
          value={formatDuration(overview.averageDurationSeconds)}
          note="from start to reward"
        />
        <StatTile
          label="High purchase intent"
          value={formatPercent(highIntent)}
          note={analysed > 0 ? `${overview.purchaseIntent.high} of ${analysed} analysed` : "no responses yet"}
        />
      </section>

      {overview.responses === 0 ? (
        <Card className="p-8 text-center">
          <h2 className="text-lg font-semibold">No responses yet</h2>
          <p className="mx-auto mt-1 max-w-md text-[15px] leading-snug text-ink-soft">
            Once people open your link and answer, their responses and what they mean will appear here.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">What people are telling you</h2>
              <RefreshInsightsButton campaignId={campaign.id} />
            </div>
            {insights ? (
              <>
                <p className="mt-3 text-lg leading-snug font-medium text-balance">{insights.data.headline}</p>
                <p className="mt-2 text-[13px] text-muted">
                  AI summary of {insights.sessionsIncluded}{" "}
                  {insights.sessionsIncluded === 1 ? "response" : "responses"}.
                  {insights.sessionsIncluded < 5 && " With this few, treat it as an early read, not a conclusion."}
                  {overview.analysed > insights.sessionsIncluded && " Newer responses are being added."}
                </p>
                <div className="mt-5 grid gap-6 md:grid-cols-3">
                  <ThemeList title="Most common likes" themes={insights.data.topLikes} total={insights.sessionsIncluded} />
                  <ThemeList
                    title="Most common objections"
                    themes={insights.data.topObjections}
                    total={insights.sessionsIncluded}
                  />
                  <ThemeList
                    title="Most requested changes"
                    themes={insights.data.requestedChanges}
                    total={insights.sessionsIncluded}
                  />
                </div>
                {insights.data.themes.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold">Other themes</h3>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {insights.data.themes.map((theme) => (
                        <li key={theme.theme} className="rounded-full bg-paper px-3 py-1 text-sm text-ink-soft">
                          {theme.theme}{" "}
                          <span className="font-semibold tabular-nums text-ink">{theme.sessionIds.length}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {insights.data.quotes.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold">In their words</h3>
                    <ul className="mt-2 grid gap-2 md:grid-cols-2">
                      {insights.data.quotes.map((quote) => (
                        <li key={quote.quote}>
                          <Link
                            href={`/dashboard/campaigns/${campaign.id}/responses/${quote.sessionId}`}
                            className="block h-full rounded-xl bg-paper px-4 py-3 text-[15px] leading-snug text-ink-soft transition hover:text-ink"
                          >
                            “{quote.quote}”
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {insights.data.suggestedActions.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold">Worth considering</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-snug text-ink-soft">
                      {insights.data.suggestedActions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">
                The summary is being written. Refresh in a few seconds.
              </p>
            )}
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="p-5">
              <h2 className="text-base font-semibold">Overall sentiment</h2>
              <p className="mt-0.5 mb-4 text-[13px] text-muted">How each person felt about it overall.</p>
              <ShareBar
                emptyLabel="Waiting for analysis."
                segments={[
                  { key: "positive", label: "Positive", value: overview.sentiment.positive, color: CHART_COLORS.sentiment.positive },
                  { key: "mixed", label: "Mixed", value: overview.sentiment.mixed, color: CHART_COLORS.sentiment.mixed },
                  { key: "neutral", label: "Neutral", value: overview.sentiment.neutral, color: CHART_COLORS.sentiment.neutral },
                  { key: "negative", label: "Negative", value: overview.sentiment.negative, color: CHART_COLORS.sentiment.negative },
                ]}
              />
            </Card>
            <Card className="p-5">
              <h2 className="text-base font-semibold">Purchase intent</h2>
              <p className="mt-0.5 mb-4 text-[13px] text-muted">How likely each person seems to buy, from what they said.</p>
              <ShareBar
                emptyLabel="Waiting for analysis."
                segments={[
                  { key: "high", label: "High", value: overview.purchaseIntent.high, color: CHART_COLORS.level.high },
                  { key: "medium", label: "Medium", value: overview.purchaseIntent.medium, color: CHART_COLORS.level.medium },
                  { key: "low", label: "Low", value: overview.purchaseIntent.low, color: CHART_COLORS.level.low },
                  { key: "unclear", label: "Not enough signal", value: overview.purchaseIntent.unclear, color: CHART_COLORS.level.unclear },
                ]}
              />
            </Card>
            <Card className="p-5">
              <h2 className="text-base font-semibold">Price</h2>
              {overview.price ? (
                <>
                  <p className="mt-3 text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums">
                    {formatMoney(overview.price.median, overview.price.currency)}
                  </p>
                  <p className="mt-1.5 text-[13px] text-muted">
                    Typical price people named (median of {overview.price.count}
                    {overview.price.low !== overview.price.high &&
                      `, from ${formatMoney(overview.price.low, overview.price.currency)} to ${formatMoney(overview.price.high, overview.price.currency)}`}
                    ).
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">Nobody has named a price yet.</p>
              )}
              {insights?.data.priceExpectations.summary && (
                <p className="mt-3 text-sm leading-snug text-ink-soft">{insights.data.priceExpectations.summary}</p>
              )}
              <h3 className="mt-5 mb-3 text-sm font-semibold">Price sensitivity</h3>
              <ShareBar
                emptyLabel="Waiting for analysis."
                segments={[
                  { key: "high", label: "High", value: overview.priceSensitivity.high, color: CHART_COLORS.level.high },
                  { key: "medium", label: "Medium", value: overview.priceSensitivity.medium, color: CHART_COLORS.level.medium },
                  { key: "low", label: "Low", value: overview.priceSensitivity.low, color: CHART_COLORS.level.low },
                  { key: "unclear", label: "Not enough signal", value: overview.priceSensitivity.unclear, color: CHART_COLORS.level.unclear },
                ]}
              />
            </Card>
            <Card className="p-5">
              <h2 className="text-base font-semibold">Where responses come from</h2>
              <p className="mt-0.5 mb-4 text-[13px] text-muted">
                Approximate, from {overview.locationsKnown} of {overview.responses}{" "}
                {overview.responses === 1 ? "person" : "people"} who shared a location.
              </p>
              <BarList items={overview.locations} emptyLabel="No location data yet." />
              {overview.sources.length > 0 && (
                <>
                  <h3 className="mt-5 mb-3 text-sm font-semibold">Link source</h3>
                  <BarList items={overview.sources} emptyLabel="" />
                </>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Latest responses</h2>
              {overview.responses > RECENT_RESPONSES && (
                <Link
                  href={`/dashboard/campaigns/${campaign.id}/responses`}
                  className="text-sm font-semibold underline-offset-4 hover:underline"
                >
                  View all {overview.responses}
                </Link>
              )}
            </div>
            <ResponseTable campaignId={campaign.id} responses={responses} />
          </Card>
        </>
      )}
    </div>
  );
}

function ThemeList({ title, themes, total }: { title: string; themes: StoredTheme[]; total: number }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {themes.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing recurring yet.</p>
      ) : (
        <ul className="mt-2 space-y-2.5">
          {themes.slice(0, 5).map((theme) => (
            <li key={theme.theme}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink-soft">{theme.theme}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-semibold">{theme.sessionIds.length}</span>
                  <span className="text-muted"> of {total}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-r bg-line/60">
                <div
                  className="h-full rounded-r"
                  style={{
                    width: `${Math.max(3, (theme.sessionIds.length / Math.max(total, 1)) * 100)}%`,
                    backgroundColor: CHART_COLORS.bar,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
