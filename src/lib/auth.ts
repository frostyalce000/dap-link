import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { merchants, type Merchant } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The signed-in merchant for this request, or null.
 *
 * `getUser()` validates the session with Supabase Auth rather than trusting
 * the cookie contents. Wrapped in React `cache` so a page and its layout share
 * one lookup per request.
 */
export const getCurrentMerchant = cache(async (): Promise<Merchant | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [existing] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, user.id))
    .limit(1);
  if (existing) return existing;

  // The auth user exists but the profile row does not (e.g. sign-up was
  // interrupted between the two writes). Create it now.
  const brandName =
    typeof user.user_metadata?.brand_name === "string" && user.user_metadata.brand_name
      ? user.user_metadata.brand_name
      : (user.email ?? "My brand").split("@")[0];
  const [created] = await db
    .insert(merchants)
    .values({ id: user.id, email: user.email ?? "", brandName })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db.select().from(merchants).where(eq(merchants.id, user.id)).limit(1);
  return row ?? null;
});

/** For dashboard pages and actions: returns the merchant or redirects to login. */
export async function requireMerchant(): Promise<Merchant> {
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/login");
  return merchant;
}
