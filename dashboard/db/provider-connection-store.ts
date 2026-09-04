import { and, eq, ne } from "drizzle-orm";
import {
  encryptProviderTokens,
  type Provider,
  type ProviderTokenSecret,
} from "../app/provider-crypto";
import { getDb, type Database } from "./index";
import { oauthSessions, providerConnections, providerCredentials } from "./schema";

export async function completeProviderAuthorization(input: {
  sessionId: string;
  memberId: string;
  provider: Provider;
  providerSubjectHash: string;
  grantedScopes: string;
  tokens: ProviderTokenSecret;
  expiresAt: number;
  keyMaterial: string;
  keyVersion?: number;
}, database?: Database): Promise<string> {
  const db = database ?? await getDb();
  const [duplicate] = await db
    .select({ id: providerConnections.id })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.provider, input.provider),
        eq(providerConnections.providerSubjectHash, input.providerSubjectHash),
        ne(providerConnections.memberId, input.memberId),
      ),
    )
    .limit(1);
  if (duplicate) {
    throw new Error("This provider account is already paired with another member.");
  }

  const [existing] = await db
    .select({ id: providerConnections.id })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.memberId, input.memberId),
        eq(providerConnections.provider, input.provider),
      ),
    )
    .limit(1);
  const connectionId = existing?.id ?? crypto.randomUUID();
  const keyVersion = input.keyVersion ?? 1;
  const encrypted = await encryptProviderTokens({
    connectionId,
    provider: input.provider,
    tokens: input.tokens,
    expiresAt: input.expiresAt,
    keyVersion,
    keyMaterial: input.keyMaterial,
  });
  const now = Date.now();

  await db.batch([
    db
      .insert(providerConnections)
      .values({
        id: connectionId,
        memberId: input.memberId,
        provider: input.provider,
        providerSubjectHash: input.providerSubjectHash,
        grantedScopes: input.grantedScopes,
        status: "connected",
        connectedAt: now,
        disconnectedAt: null,
        lastAttemptAt: now,
        lastSuccessAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [providerConnections.memberId, providerConnections.provider],
        set: {
          providerSubjectHash: input.providerSubjectHash,
          grantedScopes: input.grantedScopes,
          status: "connected",
          connectedAt: now,
          disconnectedAt: null,
          lastAttemptAt: now,
          lastSuccessAt: now,
          updatedAt: now,
        },
      }),
    db
      .insert(providerCredentials)
      .values({ connectionId, ...encrypted, updatedAt: now })
      .onConflictDoUpdate({
        target: providerCredentials.connectionId,
        set: { ...encrypted, updatedAt: now },
      }),
    db
      .update(oauthSessions)
      .set({ status: "authorized", consumedAt: now })
      .where(and(eq(oauthSessions.id, input.sessionId), eq(oauthSessions.status, "pending"))),
  ]);

  return connectionId;
}
