import { getChatGPTUser } from "../../../../../../../chatgpt-auth";
import { getHouseholdContext, householdHasMember } from "../../../../../../../../db/household-store";
import { readOAuthSession, setOAuthSessionStatus } from "../../../../../../../../db/oauth-session-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
export async function GET(_request: Request,
  context: { params: Promise<{ memberId: string; sessionId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  const household = await getHouseholdContext(user);
  if (!household) return Response.json({ error: "household_membership_required" }, { status: 403, headers: NO_STORE_HEADERS });
  if (household.role !== "owner") return Response.json({ error: "owner_access_required" }, { status: 403, headers: NO_STORE_HEADERS });
  try {
    const { memberId, sessionId } = await context.params;
    if (!(await householdHasMember(household.householdId, memberId)))
      return Response.json({ error: "member_not_found" }, { status: 404, headers: NO_STORE_HEADERS });
    const session = await readOAuthSession(sessionId, "oura");
    if (!session || session.memberId !== memberId)
      return Response.json({ error: "authorization_not_found" }, { status: 404, headers: NO_STORE_HEADERS });
    let status = session.status;
    if (status === "pending" && session.expiresAt <= Date.now()) {
      await setOAuthSessionStatus(session.id, "expired");
      status = "expired";
    }
    return Response.json({ id: session.id, provider: session.provider, status, expiresAt: session.expiresAt },
      { headers: NO_STORE_HEADERS });
  } catch {
    console.error("Oura authorization status unavailable");
    return Response.json({ error: "oura_authorization_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
