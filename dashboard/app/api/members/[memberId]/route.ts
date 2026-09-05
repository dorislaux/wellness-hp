import { getChatGPTUser } from "../../../chatgpt-auth";
import { isAllowedHouseholdUser } from "../../../household-auth";
import { ensureOwnerHousehold, HOUSEHOLD_AVATAR_COLORS, updateHouseholdMember } from "../../../../db/household-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 2_048;

export async function PATCH(request: Request, context: { params: Promise<{ memberId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  if (!isAllowedHouseholdUser(user))
    return Response.json({ error: "household_access_denied" }, { status: 403, headers: NO_STORE_HEADERS });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE_HEADERS });

  try {
    const household = await ensureOwnerHousehold(user);
    if (household.role !== "owner")
      return Response.json({ error: "owner_access_required" }, { status: 403, headers: NO_STORE_HEADERS });
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
      return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE_HEADERS });
    const payload = JSON.parse(text) as { name?: unknown; avatar?: unknown };
    if (typeof payload.name !== "string" || typeof payload.avatar !== "string")
      return Response.json({ error: "invalid_member_update" }, { status: 400, headers: NO_STORE_HEADERS });
    const name = payload.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > 80 || !HOUSEHOLD_AVATAR_COLORS.includes(payload.avatar as typeof HOUSEHOLD_AVATAR_COLORS[number]))
      return Response.json({ error: "invalid_member_update" }, { status: 400, headers: NO_STORE_HEADERS });
    const { memberId } = await context.params;
    const member = await updateHouseholdMember(household.householdId, memberId,
      { displayName: name, avatar: payload.avatar });
    return Response.json({ member }, { headers: NO_STORE_HEADERS });
  } catch {
    console.error("Household member could not be updated");
    return Response.json({ error: "member_update_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
