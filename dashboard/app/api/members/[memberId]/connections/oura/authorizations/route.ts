import { getChatGPTUser } from "../../../../../../chatgpt-auth";
import { isAllowedHouseholdUser } from "../../../../../../household-auth";
import { buildOuraAuthorizationUrl, OURA_SCOPES } from "../../../../../../providers/oura";
import { createOpaqueOAuthState, hashOAuthState } from "../../../../../../provider-crypto";
import { ensureOwnerHousehold, householdHasMember } from "../../../../../../../db/household-store";
import { createOAuthSession } from "../../../../../../../db/oauth-session-store";
import QRCode from "qrcode";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const SESSION_TTL_MS = 10 * 60 * 1000;
function requiredConfig(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export async function POST(_request: Request, context: { params: Promise<{ memberId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  if (!isAllowedHouseholdUser(user))
    return Response.json({ error: "household_access_denied" }, { status: 403, headers: NO_STORE_HEADERS });
  try {
    const { memberId } = await context.params;
    const household = await ensureOwnerHousehold(user);
    if (!(await householdHasMember(household.householdId, memberId)))
      return Response.json({ error: "member_not_found" }, { status: 404, headers: NO_STORE_HEADERS });
    const state = createOpaqueOAuthState();
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    await createOAuthSession({ id, memberId, provider: "oura",
      stateDigest: await hashOAuthState(state, requiredConfig("OAUTH_STATE_HASH_KEY_V1")),
      requestedScopes: OURA_SCOPES, createdByUserId: user.userId, expiresAt });
    const authorizationUrl = buildOuraAuthorizationUrl({ clientId: requiredConfig("OURA_CLIENT_ID"),
      clientSecret: requiredConfig("OURA_CLIENT_SECRET"), redirectUri: requiredConfig("OURA_REDIRECT_URI") }, state);
    const qrCodeDataUrl = await QRCode.toDataURL(authorizationUrl, { width: 256, margin: 1, errorCorrectionLevel: "M" });
    return Response.json({ id, provider: "oura", status: "pending", authorizationUrl, qrCodeDataUrl, expiresAt },
      { status: 201, headers: NO_STORE_HEADERS });
  } catch {
    console.error("Oura authorization could not be started");
    return Response.json({ error: "oura_authorization_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
