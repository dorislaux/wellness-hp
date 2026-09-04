import { getChatGPTUser } from "../../../../../../../chatgpt-auth";
import { isAllowedHouseholdUser } from "../../../../../../../household-auth";
import { ensureOwnerHousehold, householdHasMember } from "../../../../../../../../db/household-store";
import { readOAuthSession, setOAuthSessionStatus } from "../../../../../../../../db/oauth-session-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(
  _request: Request,
  context: { params: Promise<{ memberId: string; sessionId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  if (!isAllowedHouseholdUser(user)) {
    return Response.json({ error: "household_access_denied" }, { status: 403, headers: NO_STORE_HEADERS });
  }
  try {
    const { memberId, sessionId } = await context.params;
    const household = await ensureOwnerHousehold(user);
    if (!(await householdHasMember(household.householdId, memberId))) {
      return Response.json({ error: "member_not_found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const session = await readOAuthSession(sessionId, "whoop");
    if (!session || session.memberId !== memberId) {
      return Response.json({ error: "authorization_not_found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    let status = session.status;
    if (status === "pending" && session.expiresAt <= Date.now()) {
      await setOAuthSessionStatus(session.id, "expired");
      status = "expired";
    }
    return Response.json(
      { id: session.id, provider: session.provider, status, expiresAt: session.expiresAt },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error("WHOOP authorization status unavailable");
    return Response.json({ error: "whoop_authorization_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
