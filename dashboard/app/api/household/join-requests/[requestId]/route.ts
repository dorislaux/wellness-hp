import { getChatGPTUser } from "../../../../chatgpt-auth";
import { decideHouseholdJoinRequest, HouseholdAccessError } from "../../../../../db/household-access-store";
import { getHouseholdContext } from "../../../../../db/household-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 1_024;

export async function PATCH(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  const household = await getHouseholdContext(user);
  if (!household) return Response.json({ error: "household_membership_required" }, { status: 403, headers: NO_STORE_HEADERS });
  if (household.role !== "owner") return Response.json({ error: "owner_access_required" }, { status: 403, headers: NO_STORE_HEADERS });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE_HEADERS });
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE_HEADERS });
    }
    const payload = JSON.parse(text) as { decision?: unknown };
    if (payload.decision !== "approved" && payload.decision !== "rejected") {
      return Response.json({ error: "decision_invalid" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const { requestId } = await context.params;
    await decideHouseholdJoinRequest({
      householdId: household.householdId,
      requestId,
      decision: payload.decision,
      decidedByUserId: user.userId,
    });
    return Response.json({ updated: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof HouseholdAccessError) {
      const status = error.code === "requester_already_member" ? 409 : 404;
      return Response.json({ error: error.code }, { status, headers: NO_STORE_HEADERS });
    }
    console.error("Household join request could not be updated");
    return Response.json({ error: "join_request_update_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
