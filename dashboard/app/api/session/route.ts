import { getChatGPTUser } from "../../chatgpt-auth";
import { isAllowedHouseholdUser } from "../../household-auth";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  if (!isAllowedHouseholdUser(user)) {
    return Response.json({ error: "household_access_denied" }, { status: 403 });
  }
  return Response.json({
    authenticated: true,
    user: {
      id: user.userId,
      email: user.email,
      displayName: user.displayName,
    },
  });
}
