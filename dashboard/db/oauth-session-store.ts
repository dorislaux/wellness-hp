import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "./index";
import { oauthSessions } from "./schema";

type Provider = "oura" | "whoop";

export async function createOAuthSession(input: {
  id: string;
  memberId: string;
  provider: Provider;
  stateDigest: string;
  requestedScopes: string;
  createdByUserId: string;
  expiresAt: number;
}, database?: Database) {
  const db = database ?? await getDb();
  await db.insert(oauthSessions).values(input);
}

export async function readOAuthSession(
  id: string,
  provider: Provider,
  database?: Database,
) {
  const db = database ?? await getDb();
  const [row] = await db
    .select()
    .from(oauthSessions)
    .where(and(eq(oauthSessions.id, id), eq(oauthSessions.provider, provider)))
    .limit(1);
  return row ?? null;
}

export async function findOAuthSessionByState(
  stateDigest: string,
  provider: Provider,
  database?: Database,
) {
  const db = database ?? await getDb();
  const [row] = await db
    .select()
    .from(oauthSessions)
    .where(and(eq(oauthSessions.stateDigest, stateDigest), eq(oauthSessions.provider, provider)))
    .limit(1);
  return row ?? null;
}

export async function setOAuthSessionStatus(
  id: string,
  status: "authorized" | "denied" | "expired" | "failed",
  database?: Database,
) {
  const db = database ?? await getDb();
  await db
    .update(oauthSessions)
    .set({ status, consumedAt: Date.now() })
    .where(and(eq(oauthSessions.id, id), eq(oauthSessions.status, "pending")));
}
