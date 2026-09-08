import { exchangeOuraCode, getOuraProfile } from "../../../providers/oura";
import { hashOAuthState, hashProviderSubject } from "../../../provider-crypto";
import { findOAuthSessionByState, setOAuthSessionStatus } from "../../../../db/oauth-session-store";
import { completeProviderAuthorization } from "../../../../db/provider-connection-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store", "Content-Type": "text/html; charset=utf-8" };
function requiredConfig(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}
function page(title: string, message: string, status = 200): Response {
  const clean = (value: string) => value.replace(/[<>&"']/g, "");
  return new Response(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>${clean(title)}</title><body style="font-family:system-ui;padding:2rem;max-width:36rem;margin:auto"><h1>${clean(title)}</h1><p>${clean(message)}</p><p>You may close this window and return to the dashboard.</p></body></html>`,
    { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) return page("Authorization failed", "The authorization state was missing.", 400);
  let session: Awaited<ReturnType<typeof findOAuthSessionByState>> | null = null;
  try {
    const digest = await hashOAuthState(state, requiredConfig("OAUTH_STATE_HASH_KEY_V1"));
    session = await findOAuthSessionByState(digest, "oura");
    if (!session || session.status !== "pending")
      return page("Authorization unavailable", "This authorization link is invalid or has already been used.", 400);
    if (session.expiresAt <= Date.now()) {
      await setOAuthSessionStatus(session.id, "expired");
      return page("Authorization expired", "Please start a new connection from the dashboard.", 400);
    }
    if (url.searchParams.has("error")) {
      await setOAuthSessionStatus(session.id, "denied");
      return page("Authorization cancelled", "Oura access was not granted.", 400);
    }
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Authorization code missing.");
    const tokens = await exchangeOuraCode({ clientId: requiredConfig("OURA_CLIENT_ID"),
      clientSecret: requiredConfig("OURA_CLIENT_SECRET"), redirectUri: requiredConfig("OURA_REDIRECT_URI") }, code);
    const profile = await getOuraProfile(tokens.accessToken);
    const providerSubjectHash = await hashProviderSubject({ provider: "oura", providerSubject: profile.userId,
      keyMaterial: requiredConfig("PROVIDER_SUBJECT_HASH_KEY_V1") });
    await completeProviderAuthorization({ sessionId: session.id, memberId: session.memberId, provider: "oura",
      providerSubjectHash, grantedScopes: tokens.grantedScopes, tokens, expiresAt: tokens.expiresAt,
      keyMaterial: requiredConfig("TOKEN_ENCRYPTION_KEY_V1") });
    return page("Oura connected", "Your Oura account is now connected.");
  } catch {
    if (session?.status === "pending") await setOAuthSessionStatus(session.id, "failed").catch(() => undefined);
    console.error("Oura callback failed");
    return page("Authorization failed", "Oura could not be connected. Please try again.", 500);
  }
}
