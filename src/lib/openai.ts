import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";

let client: OpenAI | undefined;

/**
 * Shared OpenAI client. The SDK retries rate-limit, timeout and 5xx failures
 * with exponential backoff, so callers only see an error once retries are
 * exhausted.
 */
export function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: env.openaiApiKey, maxRetries: 3, timeout: 45_000 });
  return client;
}

/**
 * Asks a model for JSON matching a schema and parses it with the given
 * validator. Strict structured output guarantees the shape; validating again
 * means a malformed reply fails here rather than reaching the database.
 */
export async function generateStructured<T>(params: {
  model: string;
  name: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  parse: (value: unknown) => T;
}): Promise<T> {
  const completion = await openai().chat.completions.create({
    model: params.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: params.name, strict: true, schema: params.schema },
    },
  });

  const message = completion.choices[0]?.message;
  if (message?.refusal) throw new Error("Model declined to answer");
  if (!message?.content) throw new Error("Model returned no content");
  return params.parse(JSON.parse(message.content));
}
