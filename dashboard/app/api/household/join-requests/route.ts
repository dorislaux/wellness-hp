import { getChatGPTUser } from "../../../chatgpt-auth";
import { createHouseholdJoinRequest, HouseholdAccessError } from "../../../../db/household-access-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 2_048;

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE_HEADERS });
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return Response.json({ error: "request_too_large" }, { status: 413, headers: NO_STORE_HEADERS });
    }
    const payload = JSON.parse(text) as { token?: unknown };
    if (typeof payload.token !== "string") {
      return Response.json({ error: "invitation_invalid" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const joinRequest = await createHouseholdJoinRequest({ user, token: payload.token.trim() });
    return Response.json({ joinRequest }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof HouseholdAccessError) {
      const status = error.code === "invitation_email_mismatch" ? 403
        : error.code === "already_member" || error.code === "join_request_pending" ? 409 : 404;
      return Response.json({ error: error.code }, { status, headers: NO_STORE_HEADERS });
    }
    console.error("Household join request could not be created");
    return Response.json({ error: "join_request_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
