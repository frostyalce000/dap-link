"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { merchants } from "@/db/schema";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { getClientIp, hashIp } from "@/lib/request";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validation";

export type AuthState = { error?: string; fields?: { email?: string; brandName?: string } };

const signupSchema = z.object({
  brandName: z.string().trim().min(2, "Enter your brand or creator name.").max(60),
  email: emailSchema,
  password: z.string().min(8, "Use at least 8 characters.").max(72),
});

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(72) });

/** Sign-in and sign-up are the obvious targets for guessing, so both are rate limited by IP. */
async function checkRateLimit(): Promise<string | null> {
  const ip = hashIp(getClientIp(await headers()));
  const result = await rateLimit(`auth:${ip ?? "unknown"}`, LIMITS.authPerIp);
  return result.ok ? null : "Too many attempts. Please wait a few minutes and try again.";
}

export async function signup(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const fields = {
    email: String(formData.get("email") ?? ""),
    brandName: String(formData.get("brandName") ?? ""),
  };
  const limited = await checkRateLimit();
  if (limited) return { error: limited, fields };

  const parsed = signupSchema.safeParse({ ...fields, password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form.", fields };
  }
  const { email, password, brandName } = parsed.data;

  // Created through the admin API with the email pre-confirmed, so a new
  // merchant can start building straight away instead of waiting for a
  // confirmation email. Email verification is listed as a next step.
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { brand_name: brandName },
  });
  if (error || !data.user) {
    const taken = error?.code === "email_exists" || /already/i.test(error?.message ?? "");
    return {
      error: taken
        ? "An account with this email already exists. Try logging in."
        : "We couldn't create your account. Please try again.",
      fields,
    };
  }

  await db
    .insert(merchants)
    .values({ id: data.user.id, email, brandName })
    .onConflictDoNothing();

  const supabase = await createSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) redirect("/login");
  redirect("/dashboard/campaigns/new");
}

export async function login(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const fields = { email: String(formData.get("email") ?? "") };
  const limited = await checkRateLimit();
  if (limited) return { error: limited, fields };

  const parsed = loginSchema.safeParse({ ...fields, password: formData.get("password") });
  // One message for every failure, so the form doesn't reveal which emails have accounts.
  const invalid = { error: "That email and password don't match.", fields };
  if (!parsed.success) return invalid;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return invalid;
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
