import { getChatGPTUser } from "../../chatgpt-auth";
import { createHouseholdForUser, getHouseholdContext } from "../../../db/household-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 2_048;

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  if (await getHouseholdContext(user)) {
    return Response.json({ error: "already_member" }, { status: 409, headers: NO_STORE_HEADERS });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE_HEADERS });
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE_HEADERS });
    }
    const payload = JSON.parse(text) as { name?: unknown; timezone?: unknown };
    if (typeof payload.name !== "string" || !payload.name.trim() || payload.name.trim().length > 80
      || typeof payload.timezone !== "string" || !payload.timezone.trim() || payload.timezone.length > 64) {
      return Response.json({ error: "household_name_invalid" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: payload.timezone }).format(new Date());
    } catch {
      return Response.json({ error: "household_timezone_invalid" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    await createHouseholdForUser(user, { name: payload.name, timezone: payload.timezone });
    return Response.json({ created: true }, { status: 201, headers: NO_STORE_HEADERS });
  } catch {
    console.error("Household could not be created");
    return Response.json({ error: "household_creation_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
