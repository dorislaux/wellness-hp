export type Provider = "oura" | "whoop";

export type ProviderTokenSecret = {
  accessToken: string;
  refreshToken: string;
};

export type EncryptedTokenEnvelope = {
  encryptedTokenSet: string;
  nonce: string;
  keyVersion: number;
  expiresAt: number;
};

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BITS = 128;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Secret key must be unpadded base64url.");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function validateContext(connectionId: string, provider: Provider, keyVersion: number) {
  if (!connectionId || connectionId.length > 128) {
    throw new Error("Connection ID is invalid.");
  }
  if (provider !== "oura" && provider !== "whoop") {
    throw new Error("Provider is invalid.");
  }
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
    throw new Error("Key version is invalid.");
  }
}

function validateTokenSecret(tokens: ProviderTokenSecret) {
  if (
    typeof tokens.accessToken !== "string" ||
    typeof tokens.refreshToken !== "string" ||
    !tokens.accessToken ||
    !tokens.refreshToken
  ) {
    throw new Error("Provider token set is incomplete.");
  }
  if (tokens.accessToken.length > 16_384 || tokens.refreshToken.length > 16_384) {
    throw new Error("Provider token set exceeds the size limit.");
  }
}

function additionalData(
  connectionId: string,
  provider: Provider,
  keyVersion: number,
  expiresAt: number,
) {
  return encoder.encode(
    `wellness-provider-token:${keyVersion}:${provider}:${connectionId}:${expiresAt}`,
  );
}

async function importKey(keyMaterial: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = decodeBase64Url(keyMaterial);
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error("Secret key must contain exactly 32 bytes.");
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, usage);
}

export async function encryptProviderTokens(input: {
  connectionId: string;
  provider: Provider;
  tokens: ProviderTokenSecret;
  expiresAt: number;
  keyVersion: number;
  keyMaterial: string;
}): Promise<EncryptedTokenEnvelope> {
  validateContext(input.connectionId, input.provider, input.keyVersion);
  validateTokenSecret(input.tokens);
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) {
    throw new Error("Token expiry is invalid.");
  }

  const key = await importKey(input.keyMaterial, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const plaintext = encoder.encode(JSON.stringify(input.tokens));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: additionalData(
        input.connectionId,
        input.provider,
        input.keyVersion,
        input.expiresAt,
      ),
      tagLength: TAG_BITS,
    },
    key,
    plaintext,
  );

  return {
    encryptedTokenSet: encodeBase64Url(ciphertext),
    nonce: encodeBase64Url(nonce),
    keyVersion: input.keyVersion,
    expiresAt: input.expiresAt,
  };
}

export async function decryptProviderTokens(input: {
  connectionId: string;
  provider: Provider;
  envelope: EncryptedTokenEnvelope;
  keyMaterial: string;
}): Promise<ProviderTokenSecret> {
  validateContext(input.connectionId, input.provider, input.envelope.keyVersion);
  try {
    const key = await importKey(input.keyMaterial, ["decrypt"]);
    const nonce = decodeBase64Url(input.envelope.nonce);
    if (nonce.byteLength !== NONCE_BYTES) throw new Error("Invalid nonce.");
    const ciphertext = decodeBase64Url(input.envelope.encryptedTokenSet);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce as BufferSource,
        additionalData: additionalData(
          input.connectionId,
          input.provider,
          input.envelope.keyVersion,
          input.envelope.expiresAt,
        ),
        tagLength: TAG_BITS,
      },
      key,
      ciphertext as BufferSource,
    );
    const parsed = JSON.parse(decoder.decode(plaintext)) as ProviderTokenSecret;
    validateTokenSecret(parsed);
    return parsed;
  } catch {
    throw new Error("Provider credentials could not be decrypted.");
  }
}

export async function hashProviderSubject(input: {
  provider: Provider;
  providerSubject: string;
  keyMaterial: string;
}): Promise<string> {
  if (!input.providerSubject || input.providerSubject.length > 512) {
    throw new Error("Provider subject is invalid.");
  }
  const raw = decodeBase64Url(input.keyMaterial);
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error("Secret key must contain exactly 32 bytes.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${input.provider}:${input.providerSubject}`),
  );
  return encodeBase64Url(digest);
}

export function createOpaqueOAuthState(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashOAuthState(state: string, keyMaterial: string): Promise<string> {
  if (!state || state.length > 512) throw new Error("OAuth state is invalid.");
  const raw = decodeBase64Url(keyMaterial);
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error("Secret key must contain exactly 32 bytes.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(state)));
}
