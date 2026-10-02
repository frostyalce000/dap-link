import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { env } from "@/lib/env";
import { ApiError, readJson, route, tooManyRequests } from "@/lib/http";
import {
  CHAT_REPLY_SCHEMA,
  MAX_FOLLOW_UPS,
  buildChatInstructions,
  buildChatOpening,
} from "@/lib/interview/edna";
import { getTurns, loadBrief, saveTurns } from "@/lib/interview/service";
import { openai } from "@/lib/openai";
import { authenticateSession } from "@/lib/public-session";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { chatSchema } from "@/lib/validation";

export const maxDuration = 30;

const FOLLOW_UP_SUFFIX = "-followup";

const replySchema = z.object({
  follow_up: z.boolean(),
  message: z.string().min(1),
  question_number: z.number().int(),
  done: z.boolean(),
});

// `message` is absent when the browser opens (or falls back to) the typed
// interview and needs the interviewer's next line without a new answer.
const bodySchema = z.union([chatSchema, z.object({ open: z.literal(true) })]);

/**
 * One step of the typed interview. The server holds the conversation: the
 * browser sends only the participant's new message, and history is read from
 * the saved transcript. That keeps the interviewer's instructions out of the
 * participant's reach and makes a retried request return the same reply.
 */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/public/sessions/[id]/chat">) => {
  const { id } = await ctx.params;
  const session = await authenticateSession(request, id);
  if (session.status === "completed") {
    throw new ApiError(409, "already_completed", "This interview is already finished.");
  }

  const limit = await rateLimit(`chat:${session.id}`, LIMITS.chatPerSession);
  if (!limit.ok) throw tooManyRequests(limit.retryAfterSeconds);

  const body = bodySchema.parse(await readJson(request));
  const { brief } = await loadBrief(session);
  const total = brief.questions.length;
  let turns = await getTurns(session.id);

  if (session.mode !== "text") {
    await db.update(sessions).set({ mode: "text" }).where(eq(sessions.id, session.id));
  }

  if ("open" in body) {
    if (turns.length === 0) {
      const text = buildChatOpening(brief);
      await saveTurns(session.id, [{ clientTurnId: "opening", seq: 0, role: "assistant", text }]);
      return NextResponse.json({ reply: text, questionNumber: 1, done: false });
    }
    // Falling back from voice part-way through: carry on from the transcript.
  } else {
    // A retry of a message we already answered returns the saved reply.
    const existing = turns.find((t) => t.clientTurnId === body.clientTurnId);
    if (existing) {
      const reply = turns.find((t) => t.role === "assistant" && t.seq > existing.seq);
      if (reply) return NextResponse.json({ reply: reply.text, questionNumber: null, done: false });
    } else {
      const seq = (turns.at(-1)?.seq ?? -1) + 1;
      await saveTurns(session.id, [
        { clientTurnId: body.clientTurnId, seq, role: "user", text: body.message },
      ]);
      turns = await getTurns(session.id);
    }
  }

  const userTurns = turns.filter((t) => t.role === "user").length;
  // Follow-ups are marked in the turn id when they are saved, so the count
  // survives across requests without another column.
  const followUpsUsed = turns.filter((t) => t.clientTurnId.endsWith(FOLLOW_UP_SUFFIX)).length;
  const followUpsLeft = Math.max(0, MAX_FOLLOW_UPS - followUpsUsed);
  // Safety net so a conversation cannot run on indefinitely.
  const mustFinish = userTurns >= total + MAX_FOLLOW_UPS + 1;

  const completion = await openai().chat.completions.create({
    model: env.chatModel,
    messages: [
      { role: "system", content: buildChatInstructions(brief) },
      ...turns.map((t) => ({ role: t.role, content: t.text }) as const),
      {
        role: "system" as const,
        content:
          followUpsLeft > 0
            ? `Follow-ups left: ${followUpsLeft}. If the last answer was vague, use one now.`
            : "No follow-ups left. Accept the answer as it is and move to the next question, or wrap up.",
      },
      ...(mustFinish
        ? [{ role: "system" as const, content: "Wrap up now: thank them briefly and set done to true." }]
        : "open" in body
          ? [{ role: "system" as const, content: "The participant has switched from voice to typing. Carry on from where the conversation left off, without re-asking anything already answered." }]
          : []),
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "interviewer_reply", strict: true, schema: CHAT_REPLY_SCHEMA },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new ApiError(502, "interviewer_unavailable", "EDNA didn't respond. Please try again.");
  const reply = replySchema.parse(JSON.parse(content));

  const seq = (turns.at(-1)?.seq ?? -1) + 1;
  await saveTurns(session.id, [
    {
      clientTurnId: `assistant-${seq}${reply.follow_up && !reply.done ? FOLLOW_UP_SUFFIX : ""}`,
      seq,
      role: "assistant",
      text: reply.message,
    },
  ]);

  return NextResponse.json({
    reply: reply.message,
    questionNumber: Math.min(Math.max(reply.question_number, 1), total),
    done: reply.done || mustFinish,
  });
});
