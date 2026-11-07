// The database helper. You don't need to change this file.
//
// connect() returns a pg Pool. Use it as `await db.query(sql, values)`, which resolves to
// `{ rows }`. pg turns a `numeric` into a string and a `double precision`, such as a pgvector
// distance, into a number.

import pg from "pg";

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5450/support";

const where = () => new URL(DATABASE_URL).host;

/**
 * Connects to the project's database and checks that `npm run setup` loaded the data.
 * Throws an error that says what to run when it can't.
 */
export async function connect() {
  const db = new pg.Pool({ connectionString: DATABASE_URL, max: 4, connectionTimeoutMillis: 3000 });
  try {
    await db.query("SELECT 1");
  } catch (error) {
    await db.end();
    throw new Error(
      `Can't connect to PostgreSQL at ${where()} (${error.code ?? error.message}). ` +
        "Start it with `docker compose up -d --wait`, then load the data with `npm run setup`.",
    );
  }
  const { rows } = await db.query("SELECT to_regclass('public.chunks') IS NOT NULL AS loaded");
  if (!rows[0].loaded) {
    await db.end();
    throw new Error(`The database at ${where()} has no chunks table. Load the data with \`npm run setup\`.`);
  }
  return db;
}

/** A question's stored embedding, as an array of 256 numbers, from the `questions` table. */
export async function questionEmbedding(db, questionId) {
  const { rows } = await db.query("SELECT embedding::text AS embedding FROM questions WHERE id = $1", [questionId]);
  if (rows.length === 0) throw new Error(`No question ${questionId} in the questions table.`);
  return JSON.parse(rows[0].embedding);
}

/** One order from the `orders` table, in the shape of src/lib/orders.mjs, or null. */
export async function findOrderInDb(db, orderId) {
  const { rows } = await db.query(
    "SELECT id, tenant_id, email, status, total, to_char(ordered_on, 'YYYY-MM-DD') AS ordered_on FROM orders WHERE id = $1",
    [orderId],
  );
  if (rows.length === 0) return null;
  const [row] = rows;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    status: row.status,
    totalCents: Math.round(Number(row.total) * 100),
    orderedOn: row.ordered_on,
  };
}
