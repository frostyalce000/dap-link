import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type RewardEmail = {
  to: string;
  brandName: string;
  productName: string;
  rewardHeadline: string;
  code: string;
  instructions: string;
  /** Sent with the request so the provider drops an accidental second send. */
  idempotencyKey?: string;
};

/**
 * sent    delivered to the provider
 * skipped no email provider is configured
 * failed  the provider rejected it for good (e.g. an invalid address)
 * retry   a temporary failure (rate limit, outage) worth trying again later
 */
export type EmailResult = { status: "sent" | "skipped" | "failed" | "retry" };

const SEND_ATTEMPTS = 3;

function isTemporary(error: { name?: string; statusCode?: number | null }): boolean {
  return (
    error.name === "rate_limit_exceeded" ||
    error.statusCode === 429 ||
    (typeof error.statusCode === "number" && error.statusCode >= 500)
  );
}

/**
 * Emails the discount code. The code is always shown on screen first, so this
 * is a convenience copy: a failure here is recorded but never surfaces as an
 * error to the participant.
 */
export async function sendRewardEmail(email: RewardEmail): Promise<EmailResult> {
  if (!env.resendApiKey) return { status: "skipped" };

  const brand = escapeHtml(email.brandName);
  const product = escapeHtml(email.productName);
  const headline = escapeHtml(email.rewardHeadline);
  const code = escapeHtml(email.code);
  const instructions = email.instructions ? escapeHtml(email.instructions) : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f6f4ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#17150f;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:20px;padding:32px;">
          <tr><td>
            <p style="margin:0 0 4px;font-size:13px;color:#6b665a;">${brand}</p>
            <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;">Thanks for your feedback</h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#3d3a32;">
              You shared your thoughts on ${product}. Here's your reward: <strong>${headline}</strong>.
            </p>
            <div style="border:1.5px dashed #17150f;border-radius:14px;padding:18px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b665a;">Your code</p>
              <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:.06em;font-family:ui-monospace,Menlo,Consolas,monospace;">${code}</p>
            </div>
            ${instructions ? `<p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:#3d3a32;">${instructions}</p>` : ""}
            <p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#8a8577;">
              You're receiving this once because you asked for your reward to be sent here. You won't get marketing emails from this.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `Thanks for your feedback on ${email.productName}.`,
    `Your reward from ${email.brandName}: ${email.rewardHeadline}`,
    `Your code: ${email.code}`,
    email.instructions,
  ]
    .filter(Boolean)
    .join("\n\n");

  const resend = new Resend(env.resendApiKey);
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    try {
      const { error } = await resend.emails.send(
        {
          from: env.resendFrom,
          to: email.to,
          subject: `Your reward from ${email.brandName}: ${email.rewardHeadline}`,
          html,
          text,
        },
        email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : undefined,
      );
      if (!error) return { status: "sent" };
      if (!isTemporary(error)) {
        console.error("[email] reward email rejected:", error.name);
        return { status: "failed" };
      }
    } catch (err) {
      // A network error: treated as temporary.
      console.error("[email] reward email error:", err instanceof Error ? err.name : "unknown");
    }
    if (attempt < SEND_ATTEMPTS) {
      // Back off with jitter so a burst of sends doesn't retry in step.
      await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** (attempt - 1) + Math.random() * 800));
    }
  }
  return { status: "retry" };
}
