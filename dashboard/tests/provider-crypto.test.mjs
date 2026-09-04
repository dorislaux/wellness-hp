import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  decryptProviderTokens,
  encryptProviderTokens,
  createOpaqueOAuthState,
  hashOAuthState,
  hashProviderSubject,
} from "../app/provider-crypto.ts";

const secret = () => randomBytes(32).toString("base64url");
const tokens = {
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
};

test("encrypts and decrypts a provider token set", async () => {
  const keyMaterial = secret();
  const envelope = await encryptProviderTokens({
    connectionId: "connection-1",
    provider: "whoop",
    tokens,
    expiresAt: 1_800_000_000_000,
    keyVersion: 1,
    keyMaterial,
  });

  assert.equal(envelope.keyVersion, 1);
  assert.equal(envelope.expiresAt, 1_800_000_000_000);
  assert.doesNotMatch(envelope.encryptedTokenSet, /test-access-token/);
  assert.deepEqual(
    await decryptProviderTokens({
      connectionId: "connection-1",
      provider: "whoop",
      envelope,
      keyMaterial,
    }),
    tokens,
  );
});

test("creates opaque OAuth state and stable keyed state digests", async () => {
  const keyMaterial = secret();
  const first = createOpaqueOAuthState();
  const second = createOpaqueOAuthState();
  assert.notEqual(first, second);
  assert.ok(first.length >= 32);
  assert.equal(
    await hashOAuthState(first, keyMaterial),
    await hashOAuthState(first, keyMaterial),
  );
  assert.notEqual(await hashOAuthState(first, keyMaterial), first);
});

test("uses a fresh nonce for every encryption", async () => {
  const input = {
    connectionId: "connection-1",
    provider: "oura",
    tokens,
    expiresAt: 1_800_000_000_000,
    keyVersion: 1,
    keyMaterial: secret(),
  };
  const first = await encryptProviderTokens(input);
  const second = await encryptProviderTokens(input);
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.encryptedTokenSet, second.encryptedTokenSet);
});

test("binds ciphertext to its connection and provider", async () => {
  const keyMaterial = secret();
  const envelope = await encryptProviderTokens({
    connectionId: "connection-1",
    provider: "whoop",
    tokens,
    expiresAt: 1_800_000_000_000,
    keyVersion: 1,
    keyMaterial,
  });

  await assert.rejects(
    decryptProviderTokens({
      connectionId: "connection-2",
      provider: "whoop",
      envelope,
      keyMaterial,
    }),
    /could not be decrypted/,
  );
  await assert.rejects(
    decryptProviderTokens({
      connectionId: "connection-1",
      provider: "oura",
      envelope,
      keyMaterial,
    }),
    /could not be decrypted/,
  );
  await assert.rejects(
    decryptProviderTokens({
      connectionId: "connection-1",
      provider: "whoop",
      envelope: { ...envelope, expiresAt: envelope.expiresAt + 1 },
      keyMaterial,
    }),
    /could not be decrypted/,
  );
});

test("rejects the wrong key and malformed key material", async () => {
  const envelope = await encryptProviderTokens({
    connectionId: "connection-1",
    provider: "whoop",
    tokens,
    expiresAt: 1_800_000_000_000,
    keyVersion: 1,
    keyMaterial: secret(),
  });
  await assert.rejects(
    decryptProviderTokens({
      connectionId: "connection-1",
      provider: "whoop",
      envelope,
      keyMaterial: secret(),
    }),
    /could not be decrypted/,
  );
  await assert.rejects(
    encryptProviderTokens({
      connectionId: "connection-1",
      provider: "whoop",
      tokens,
      expiresAt: 1_800_000_000_000,
      keyVersion: 1,
      keyMaterial: randomBytes(16).toString("base64url"),
    }),
    /exactly 32 bytes/,
  );
});

test("creates stable provider-scoped subject hashes", async () => {
  const keyMaterial = secret();
  const whoop = await hashProviderSubject({
    provider: "whoop",
    providerSubject: "provider-user-123",
    keyMaterial,
  });
  const repeat = await hashProviderSubject({
    provider: "whoop",
    providerSubject: "provider-user-123",
    keyMaterial,
  });
  const oura = await hashProviderSubject({
    provider: "oura",
    providerSubject: "provider-user-123",
    keyMaterial,
  });
  assert.equal(whoop, repeat);
  assert.notEqual(whoop, oura);
  assert.doesNotMatch(whoop, /provider-user-123/);
});
