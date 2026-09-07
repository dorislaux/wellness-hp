import { getChatGPTUser } from "../../../../chatgpt-auth";
import { HouseholdAccessError, revokeHouseholdViewer } from "../../../../../db/household-access-store";
import { getHouseholdContext } from "../../../../../db/household-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function DELETE(_request: Request, context: { params: Promise<{ viewerId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  const household = await getHouseholdContext(user);
  if (!household) return Response.json({ error: "household_membership_required" }, { status: 403, headers: NO_STORE_HEADERS });
  if (household.role !== "owner") return Response.json({ error: "owner_access_required" }, { status: 403, headers: NO_STORE_HEADERS });
  try {
    const { viewerId } = await context.params;
    await revokeHouseholdViewer({ householdId: household.householdId, viewerUserId: viewerId, ownerUserId: user.userId });
    return Response.json({ revoked: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof HouseholdAccessError) {
      return Response.json({ error: error.code }, { status: 404, headers: NO_STORE_HEADERS });
    }
    console.error("Household viewer could not be revoked");
    return Response.json({ error: "viewer_revocation_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
