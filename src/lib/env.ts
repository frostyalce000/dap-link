import "server-only";

/** Reads a required server environment variable, failing loudly if absent. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const env = {
  get openaiApiKey() {
    return required("OPENAI_API_KEY");
  },
  /** Voice model used for the live interview. */
  get realtimeModel() {
    return process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";
  },
  get realtimeVoice() {
    return process.env.OPENAI_REALTIME_VOICE ?? "marin";
  },
  get transcriptionModel() {
    return process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe";
  },
  /** Fast model for the typed interview, where reply latency matters. */
  get chatModel() {
    return process.env.OPENAI_CHAT_MODEL ?? "gpt-5.4-mini";
  },
  /** Stronger model for analysis, which runs after the participant has left. */
  get analysisModel() {
    return process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-5.4";
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY ?? "";
  },
  get resendFrom() {
    return process.env.RESEND_FROM ?? "DAP Link <onboarding@resend.dev>";
  },
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get ipHashSalt() {
    return required("IP_HASH_SALT");
  },
  get appUrl() {
    const url =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:3000");
    return url.replace(/\/$/, "");
  },
};
