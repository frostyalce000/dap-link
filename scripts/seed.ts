/**
 * Seeds a demo merchant and a published campaign into the database in
 * DATABASE_URL, for local development without a Supabase Auth user.
 *
 *   npm run db:seed
 */
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";

config({ path: ".env.local", quiet: true });

const DEMO_MERCHANT_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_SLUG = "studio-north-hoodie";

async function main() {
  const client = postgres(process.env.DATABASE_URL ?? "", { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  await db
    .insert(schema.merchants)
    .values({ id: DEMO_MERCHANT_ID, email: "demo@example.com", brandName: "Studio North" })
    .onConflictDoNothing();

  const [existing] = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.slug, DEMO_SLUG))
    .limit(1);

  if (!existing) {
    const [campaign] = await db
      .insert(schema.campaigns)
      .values({
        merchantId: DEMO_MERCHANT_ID,
        slug: DEMO_SLUG,
        status: "published",
        productName: "The Everyday Hoodie",
        productDescription:
          "A heavyweight organic cotton hoodie in a relaxed fit. Launching next month in black, oat and forest green. Planned price: $95.",
        rewardHeadline: "20% off your first order",
        rewardKind: "generated",
        rewardCodePrefix: "NORTH20",
        rewardInstructions: "Enter the code at checkout. Valid for 30 days.",
        publishedAt: new Date(),
      })
      .returning();

    await db.insert(schema.questions).values(
      [
        "What do you think of this hoodie?",
        "How much do you think it should cost?",
        "What would make you more likely to buy it?",
      ].map((text, position) => ({ campaignId: campaign!.id, position, text })),
    );
    console.log(`Seeded campaign: /${DEMO_SLUG}`);
  } else {
    console.log(`Campaign already exists: /${DEMO_SLUG}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
