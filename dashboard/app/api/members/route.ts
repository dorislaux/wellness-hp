import { getChatGPTUser } from "../../chatgpt-auth";
import { isAllowedHouseholdUser } from "../../household-auth";
import { createHouseholdMember, ensureOwnerHousehold } from "../../../db/household-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 2_048;

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  if (!isAllowedHouseholdUser(user))
    return Response.json({ error: "household_access_denied" }, { status: 403, headers: NO_STORE_HEADERS });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE_HEADERS });
  try {
    const household = await ensureOwnerHousehold(user);
    if (household.role !== "owner")
      return Response.json({ error: "owner_access_required" }, { status: 403, headers: NO_STORE_HEADERS });
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
      return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE_HEADERS });
    const payload = JSON.parse(text) as { name?: unknown };
    if (typeof payload.name !== "string" || !payload.name.trim() || payload.name.trim().length > 80)
      return Response.json({ error: "invalid_member_name" }, { status: 400, headers: NO_STORE_HEADERS });
    const member = await createHouseholdMember(household.householdId, payload.name);
    return Response.json({ member }, { status: 201, headers: NO_STORE_HEADERS });
  } catch {
    console.error("Household member could not be created");
    return Response.json({ error: "member_creation_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
