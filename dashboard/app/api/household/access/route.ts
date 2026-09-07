import { getChatGPTUser } from "../../../chatgpt-auth";
import { listHouseholdAccess } from "../../../../db/household-access-store";
import { getHouseholdContext } from "../../../../db/household-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  const household = await getHouseholdContext(user);
  if (!household) return Response.json({ error: "household_membership_required" }, { status: 403, headers: NO_STORE_HEADERS });
  if (household.role !== "owner") return Response.json({ error: "owner_access_required" }, { status: 403, headers: NO_STORE_HEADERS });
  try {
    return Response.json(await listHouseholdAccess(household.householdId), { headers: NO_STORE_HEADERS });
  } catch {
    console.error("Household access could not be loaded");
    return Response.json({ error: "household_access_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
