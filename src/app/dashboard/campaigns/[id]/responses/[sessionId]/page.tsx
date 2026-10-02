import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { asc, eq } from "drizzle-orm";
import { SentimentBadge, levelLabel } from "@/components/dashboard/response-table";
import { Badge, Card } from "@/components/ui";
import { db } from "@/db";
import { consents, transcriptTurns } from "@/db/schema";
import { questionsAskedAt } from "@/lib/analysis/analyze-session";
import type { SessionAnalysis } from "@/lib/analysis/schema";
import { requireMerchant } from "@/lib/auth";
import { getOwnedCampaign } from "@/lib/campaigns";
import { getResponse } from "@/lib/dashboard";
import {
  capitalize,
  confidenceLabel,
  formatDateTime,
  formatDuration,
  formatLocation,
  formatMoney,
  formatPercent,
} from "@/lib/format";
import { INTERVIEWER_NAME } from "@/lib/interview/edna";

export const metadata: Metadata = { title: "Response" };

export default async function ResponsePage(
  props: PageProps<"/dashboard/campaigns/[id]/responses/[sessionId]">,
) {
  const { id, sessionId } = await props.params;
  const merchant = await requireMerchant();
  const campaign = await getOwnedCampaign(merchant.id, id);
  if (!campaign) notFound();
  const response = await getResponse(campaign.id, sessionId);
  if (!response || response.session.status !== "completed") notFound();

  const { session, insight } = response;
  const [turns, asked, [consent]] = await Promise.all([
    db
      .select()
      .from(transcriptTurns)
      .where(eq(transcriptTurns.sessionId, session.id))
      .orderBy(asc(transcriptTurns.seq), asc(transcriptTurns.createdAt)),
    questionsAskedAt(campaign.id, session.startedAt),
    db.select().from(consents).where(eq(consents.sessionId, session.id)).limit(1),
  ]);
  const analysis = insight ? (insight.data as SessionAnalysis) : null;
  const location = formatLocation(session.geoCity, session.geoCountry);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/dashboard/campaigns/${campaign.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {campaign.productName}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight break-all">
          {response.email ?? "Unknown participant"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {formatDateTime(session.completedAt)} · {session.mode === "voice" ? "Spoke" : "Typed"} ·{" "}
          {formatDuration(session.durationSeconds)}
          {location && ` · ${location}`}
          {session.deviceType && ` · ${capitalize(session.deviceType)}`}
          {session.source && ` · via ${session.source}`}
        </p>
        {session.isDuplicate && (
          <p className="mt-3 rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
            This person had already responded to this link, so this response is left out of your totals.
          </p>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-base font-semibold">AI analysis</h2>
            {analysis && insight ? (
              <>
                <p className="mt-2 text-[15px] leading-snug text-ink-soft">{analysis.summary}</p>
                <p className="mt-2 text-[13px] text-muted">
                  Inferred from the transcript by AI. Confidence shows how directly the person spoke to
                  each point.
                </p>
                <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Judgement
                    label="Sentiment"
                    value={<SentimentBadge sentiment={analysis.overall_sentiment.label} />}
                    confidence={analysis.overall_sentiment.confidence}
                  />
                  <Judgement
                    label="Purchase intent"
                    value={
                      <>
                        {levelLabel(analysis.purchase_intent.level)}
                        {analysis.purchase_intent.likelihood !== null &&
                          ` · about ${formatPercent(analysis.purchase_intent.likelihood)} likely`}
                      </>
                    }
                    confidence={analysis.purchase_intent.confidence}
                    evidence={analysis.purchase_intent.evidence}
                  />
                  <Judgement
                    label="Price sensitivity"
                    value={levelLabel(analysis.price_sensitivity.level)}
                    confidence={analysis.price_sensitivity.confidence}
                    evidence={analysis.price_sensitivity.evidence}
                  />
                  <Judgement
                    label="Price they named"
                    value={
                      analysis.willingness_to_pay.amount === null
                        ? "None given"
                        : formatMoney(analysis.willingness_to_pay.amount, analysis.willingness_to_pay.currency)
                    }
                    confidence={
                      analysis.willingness_to_pay.amount === null ? null : analysis.willingness_to_pay.confidence
                    }
                    evidence={analysis.willingness_to_pay.evidence}
                  />
                  <Judgement
                    label="Emotional tone"
                    value={
                      analysis.emotional_tone.labels.length > 0
                        ? analysis.emotional_tone.labels.map(capitalize).join(", ")
                        : "Not enough signal"
                    }
                    confidence={analysis.emotional_tone.labels.length > 0 ? analysis.emotional_tone.confidence : null}
                  />
                  {analysis.product_preference && (
                    <Judgement label="Preference" value={analysis.product_preference} confidence={null} />
                  )}
                </dl>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <PhraseList title="Likes" items={analysis.likes} />
                  <PhraseList title="Dislikes" items={analysis.dislikes} />
                  <PhraseList title="Objections" items={analysis.objections} />
                  <PhraseList title="Requested changes" items={analysis.requested_changes} />
                  <PhraseList title="Needs" items={analysis.needs} />
                  <PhraseList title="Topics" items={analysis.topics} />
                </div>

                {analysis.key_quotes.length > 0 && (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold">Key quotes</h3>
                    <ul className="mt-2 space-y-2">
                      {analysis.key_quotes.map((quote) => (
                        <li key={quote} className="rounded-xl bg-paper px-4 py-2.5 text-[15px] leading-snug text-ink-soft">
                          “{quote}”
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">
                {session.isDuplicate
                  ? "Repeat responses aren't analysed."
                  : session.analysisStatus === "failed"
                    ? "Analysis failed. It will be retried the next time you open the campaign."
                    : "This response is being analysed. Refresh in a few seconds."}
              </p>
            )}
          </Card>

          {analysis && (
            <Card className="p-5">
              <h2 className="text-base font-semibold">Answers by question</h2>
              <ol className="mt-3 space-y-4">
                {asked.map((question, index) => {
                  const answer = analysis.questions.find((q) => q.question_number === index + 1);
                  return (
                    <li key={question.id}>
                      <p className="text-sm font-semibold">
                        {index + 1}. {question.text}
                      </p>
                      {answer?.answered ? (
                        <>
                          <p className="mt-1 text-[15px] leading-snug text-ink-soft">“{answer.answer_verbatim}”</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                            <SentimentBadge sentiment={answer.sentiment} />
                            <span>{answer.answer_summary}</span>
                          </div>
                        </>
                      ) : (
                        <p className="mt-1 text-sm text-muted">Not answered.</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-base font-semibold">Transcript</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Exactly what was said. {session.mode === "voice" && "Speech was transcribed live; no audio is stored."}
            </p>
            <ol className="mt-3 space-y-3">
              {turns.map((turn) => (
                <li key={turn.id}>
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                    {turn.role === "assistant" ? INTERVIEWER_NAME : "Participant"}
                  </p>
                  <p className={`mt-0.5 text-[15px] leading-snug ${turn.role === "assistant" ? "text-muted" : "text-ink"}`}>
                    {turn.text}
                  </p>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-semibold">Reward and consent</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Code issued" value={<span className="font-mono">{response.rewardCode ?? "–"}</span>} />
              <Row
                label="Email copy"
                value={
                  response.rewardEmailStatus === "sent"
                    ? "Sent"
                    : response.rewardEmailStatus === "failed"
                      ? "Could not be sent"
                      : response.rewardEmailStatus === "skipped"
                        ? "Not sent"
                        : "Sending"
                }
              />
              {consent && (
                <>
                  <Row label="Consent given" value={formatDateTime(consent.grantedAt)} />
                  <Row label="Answers and AI analysis" value={<Badge tone="good">Agreed</Badge>} />
                  <Row
                    label="Approximate location"
                    value={
                      consent.approximateLocation ? <Badge tone="good">Agreed</Badge> : <Badge tone="neutral">Declined</Badge>
                    }
                  />
                  <Row label="Audio recording" value={<Badge tone="neutral">Not collected</Badge>} />
                </>
              )}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Judgement(props: { label: string; value: ReactNode; confidence: number | null; evidence?: string }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{props.label}</dt>
      <dd className="mt-0.5">
        <span className="text-[15px] font-semibold">{props.value}</span>
        {props.confidence !== null && (
          <span className="ml-2 text-[13px] text-muted">{confidenceLabel(props.confidence)} confidence</span>
        )}
        {props.evidence && <p className="mt-0.5 text-[13px] leading-snug text-muted">{props.evidence}</p>}
      </dd>
    </div>
  );
}

function PhraseList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted">None mentioned.</p>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item} className="rounded-full bg-paper px-2.5 py-1 text-[13px] text-ink-soft">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
