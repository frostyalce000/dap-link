import "server-only";
import { env } from "@/lib/env";
import { VOICE_TOOLS, buildVoiceInstructions, type InterviewBrief } from "./edna";

export type VoiceSecret = { clientSecret: string; model: string };

/**
 * Creates a short-lived OpenAI Realtime client secret for one interview.
 *
 * The browser connects to OpenAI directly over WebRTC with this secret, which
 * keeps audio latency low and means the real API key never leaves the server.
 * The interviewer's instructions, questions and tools are fixed here, on the
 * server, when the secret is created.
 *
 * Returns null when voice is unavailable, so the caller can fall back to the
 * typed interview instead of failing.
 */
export async function createVoiceSecret(brief: InterviewBrief): Promise<VoiceSecret | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Only needed to open the call, so it can expire quickly.
        expires_after: { anchor: "created_at", seconds: 120 },
        session: {
          type: "realtime",
          model: env.realtimeModel,
          instructions: buildVoiceInstructions(brief),
          tools: VOICE_TOOLS,
          tool_choice: "auto",
          // Bounds how long any single reply can run.
          max_output_tokens: 1024,
          audio: {
            input: {
              transcription: { model: env.transcriptionModel },
              noise_reduction: { type: "near_field" },
              // Semantic turn detection waits for the person to finish their
              // thought instead of cutting in on the first pause.
              turn_detection: {
                type: "semantic_vad",
                eagerness: "auto",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice: env.realtimeVoice },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("[voice] client secret request failed with status", response.status);
      return null;
    }
    const data = (await response.json()) as { value?: string };
    return data.value ? { clientSecret: data.value, model: env.realtimeModel } : null;
  } catch (err) {
    console.error("[voice] client secret request failed:", err instanceof Error ? err.name : "unknown");
    return null;
  }
}
