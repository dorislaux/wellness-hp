import { getChatGPTUser } from "../../../chatgpt-auth";
import { createHouseholdInvitation, HouseholdAccessError } from "../../../../db/household-access-store";
import { getHouseholdContext } from "../../../../db/household-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 2_048;

export async function POST(request: Request) {
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
    const payload = JSON.parse(text) as { email?: unknown };
    if (typeof payload.email !== "string") {
      return Response.json({ error: "invitation_email_invalid" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const invitation = await createHouseholdInvitation({
      householdId: household.householdId,
      invitedEmail: payload.email,
      createdByUserId: user.userId,
    });
    return Response.json({ invitation }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof HouseholdAccessError) {
      const status = error.code === "invitation_limit_reached" ? 409 : 400;
      return Response.json({ error: error.code }, { status, headers: NO_STORE_HEADERS });
    }
    console.error("Household invitation could not be created");
    return Response.json({ error: "invitation_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
