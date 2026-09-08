import { getChatGPTUser } from "../../chatgpt-auth";
import { getHouseholdContext } from "../../../db/household-store";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  const liveMode = (process.env.WELLNESS_DATA_MODE ?? "mock") === "sites";
  const household = liveMode ? await getHouseholdContext(user) : { role: "owner" as const };
  return Response.json({
    authenticated: true,
    household: household ? { status: "member", role: household.role } : { status: "unassigned", role: null },
    user: {
      id: user.userId,
      email: user.email,
      displayName: user.displayName,
    },
  });
}
