import { getChatGPTUser } from "../../chatgpt-auth";
import { isAllowedHouseholdUser } from "../../household-auth";
import { getWellnessSnapshot } from "../../wellness-data";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!isAllowedHouseholdUser(user)) {
    return Response.json(
      { error: "household_access_denied" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const snapshot = await getWellnessSnapshot(user);
    return Response.json(snapshot, { headers: NO_STORE_HEADERS });
  } catch {
    // Avoid logging provider responses, access tokens, or health records.
    console.error("Wellness snapshot unavailable");
    return Response.json(
      { error: "wellness_data_unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
