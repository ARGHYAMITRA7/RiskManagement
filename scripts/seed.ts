/* Command-line seeding of the SYNTHETIC demonstration dataset.
 * Usage:  npx tsx scripts/seed.ts            (seeds only when the database is empty)
 *         npx tsx scripts/seed.ts --reset    (replaces ALL data; used by reset_demo_data.bat)
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { seedSyntheticDataset } from "../src/lib/seed";

async function main() {
  const reset = process.argv.includes("--reset");
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) throw new Error("Set DEMO_PASSWORD (at least 8 characters) in .env");
  const rows = await db.execute(sql`select count(*)::int as n from users`);
  const existing = Number((rows.rows[0] as { n: number }).n);
  if (existing > 0 && !reset) {
    console.log(`Database already contains ${existing} user(s). Nothing was changed. Use --reset to regenerate the demo dataset.`);
    process.exit(0);
  }
  console.log(reset ? "Resetting data and generating the SYNTHETIC dataset (this takes a minute)..." : "Generating the SYNTHETIC dataset...");
  const summary = await seedSyntheticDataset({ reset, demoPassword: password });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
