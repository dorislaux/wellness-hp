import { getChatGPTUser } from "../../chatgpt-auth";
import { getWellnessSnapshot } from "../../wellness-data";
import { getHouseholdContext } from "../../../db/household-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if ((process.env.WELLNESS_DATA_MODE ?? "mock") === "sites" && !(await getHouseholdContext(user))) {
    return Response.json(
      { error: "household_membership_required" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const snapshot = await getWellnessSnapshot(user, { refresh: true });
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
