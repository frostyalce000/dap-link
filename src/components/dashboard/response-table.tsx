import Link from "next/link";
import { Badge } from "@/components/ui";
import type { listResponses } from "@/lib/dashboard";
import { capitalize, formatDateTime, formatLocation, formatMoney } from "@/lib/format";

type Row = Awaited<ReturnType<typeof listResponses>>[number];

const SENTIMENT_TONE = { positive: "good", mixed: "warn", neutral: "neutral", negative: "bad" } as const;

export function SentimentBadge({ sentiment }: { sentiment: string }) {
  const tone = SENTIMENT_TONE[sentiment as keyof typeof SENTIMENT_TONE] ?? "neutral";
  return <Badge tone={tone}>{capitalize(sentiment)}</Badge>;
}

/** "unclear" is shown as what it means: the interview didn't say. */
export function levelLabel(level: string): string {
  return level === "unclear" ? "Not enough signal" : capitalize(level);
}

/** Responses as a list of cards on phones and a table from tablet width up. */
export function ResponseTable({ campaignId, responses }: { campaignId: string; responses: Row[] }) {
  if (responses.length === 0) return <p className="mt-3 text-sm text-muted">No responses yet.</p>;

  return (
    <div className="mt-3 -mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[13px] text-muted">
            <th className="py-2 pr-4 font-medium">Participant</th>
            <th className="py-2 pr-4 font-medium">Sentiment</th>
            <th className="py-2 pr-4 font-medium">Purchase intent</th>
            <th className="py-2 pr-4 font-medium">Price named</th>
            <th className="py-2 font-medium">In short</th>
          </tr>
        </thead>
        <tbody>
          {responses.map((response) => (
            <tr key={response.id} className="border-b border-line align-top last:border-0">
              <td className="py-3 pr-4">
                <Link
                  href={`/dashboard/campaigns/${campaignId}/responses/${response.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {response.email ?? "Unknown"}
                </Link>
                <p className="mt-0.5 text-[13px] whitespace-nowrap text-muted">
                  {formatDateTime(response.completedAt)}
                  {formatLocation(response.geoCity, response.geoCountry) &&
                    ` · ${formatLocation(response.geoCity, response.geoCountry)}`}
                </p>
              </td>
              {response.sentiment ? (
                <>
                  <td className="py-3 pr-4">
                    <SentimentBadge sentiment={response.sentiment} />
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap text-ink-soft">
                    {levelLabel(response.purchaseIntent ?? "unclear")}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap tabular-nums text-ink-soft">
                    {formatMoney(response.willingnessToPay, response.currency)}
                  </td>
                  <td className="py-3 text-ink-soft">
                    <p className="line-clamp-2 max-w-md">{response.summary}</p>
                  </td>
                </>
              ) : (
                <td colSpan={4} className="py-3 text-muted">
                  {response.analysisStatus !== "failed"
                    ? "Being analysed…"
                    : response.analysisAttempts >= 3
                      ? "Couldn't be analysed."
                      : "Analysis failed. It will be retried."}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
