// Loads the course's ai-support dataset into the project's PostgreSQL: the two shops' help center,
// with one real embedding per chunk and question, and their orders, refunds, and tickets.
// It drops those tables first, so you can run it again at any time.
//
// data/ai-support.sql is a copy of atomicly's dataset file, made by the course's build script.

import { readFile } from "node:fs/promises";
import pg from "pg";
import { DATABASE_URL } from "../src/lib/db.mjs";

const TABLES = ["tickets", "refunds", "orders", "relevant_chunks", "questions", "chunks", "documents", "tenants"];

const db = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
try {
  await db.connect();
} catch (error) {
  console.error(`Can't connect to PostgreSQL at ${new URL(DATABASE_URL).host} (${error.code ?? error.message}).`);
  console.error("Start it with `docker compose up -d --wait`, then run `npm run setup` again.");
  process.exit(1);
}

try {
  const sql = await readFile(new URL("../data/ai-support.sql", import.meta.url), "utf8");
  await db.query("BEGIN");
  await db.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  await db.query(sql);
  await db.query("COMMIT");
  const { rows } = await db.query(`
    SELECT (SELECT count(*) FROM chunks) AS chunks, (SELECT count(*) FROM questions) AS questions,
           (SELECT count(*) FROM orders) AS orders, (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector`);
  const [loaded] = rows;
  console.log(
    `Loaded ${loaded.chunks} chunks, ${loaded.questions} questions, and ${loaded.orders} orders ` +
      `into ${new URL(DATABASE_URL).host}, with pgvector ${loaded.pgvector}.`,
  );
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error(`The setup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
