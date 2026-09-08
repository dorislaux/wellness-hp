import { eq } from "drizzle-orm";
import type { EncryptedTokenEnvelope } from "../app/provider-crypto";
import { getDb, type Database } from "./index";
import { providerCredentials } from "./schema";

export async function replaceProviderCredential(
  connectionId: string,
  envelope: EncryptedTokenEnvelope,
  database?: Database,
): Promise<void> {
  const db = database ?? await getDb();
  if (!connectionId) throw new Error("Connection ID is required.");
  const updatedAt = Date.now();
  await db
    .insert(providerCredentials)
    .values({
      connectionId,
      encryptedTokenSet: envelope.encryptedTokenSet,
      nonce: envelope.nonce,
      keyVersion: envelope.keyVersion,
      expiresAt: envelope.expiresAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: providerCredentials.connectionId,
      set: {
        encryptedTokenSet: envelope.encryptedTokenSet,
        nonce: envelope.nonce,
        keyVersion: envelope.keyVersion,
        expiresAt: envelope.expiresAt,
        updatedAt,
      },
    });
}

export async function readProviderCredential(
  connectionId: string,
  database?: Database,
): Promise<EncryptedTokenEnvelope | null> {
  const db = database ?? await getDb();
  const [row] = await db
    .select({
      encryptedTokenSet: providerCredentials.encryptedTokenSet,
      nonce: providerCredentials.nonce,
      keyVersion: providerCredentials.keyVersion,
      expiresAt: providerCredentials.expiresAt,
    })
    .from(providerCredentials)
    .where(eq(providerCredentials.connectionId, connectionId))
    .limit(1);
  return row ?? null;
}

export async function deleteProviderCredential(
  connectionId: string,
  database?: Database,
): Promise<void> {
  const db = database ?? await getDb();
  await db
    .delete(providerCredentials)
    .where(eq(providerCredentials.connectionId, connectionId));
}
