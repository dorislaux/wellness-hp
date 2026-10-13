import { getChatGPTUser, type ChatGPTUser } from "../../../chatgpt-auth";
import { getWhoopHistoryBackfillStatus, runWhoopHistoryBackfillChunk, WhoopHistoryBackfillError,
  type WhoopHistoryBackfillChunkResult, type WhoopHistoryBackfillStatus } from
  "../../../whoop-history-backfill";
import { getHouseholdContext, getHouseholdUserMemberId, type HouseholdContext } from
  "../../../../db/household-store";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_REQUEST_BYTES = 2_048;

type RouteDependencies = {
  user: () => Promise<ChatGPTUser | null>;
  household: (user: ChatGPTUser) => Promise<HouseholdContext | null>;
  memberId: (householdId: string, siteUserId: string) => Promise<string | null>;
  status: (input: { householdId: string; memberId: string; timezone: string; endDate?: string }) =>
    Promise<WhoopHistoryBackfillStatus>;
  run: (input: { householdId: string; memberId: string; timezone: string; endDate?: string }) =>
    Promise<WhoopHistoryBackfillChunkResult>;
};

const defaultDependencies: RouteDependencies = {
  user: getChatGPTUser,
  household: getHouseholdContext,
  memberId: getHouseholdUserMemberId,
  status: getWhoopHistoryBackfillStatus,
  run: runWhoopHistoryBackfillChunk,
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

async function endDateFrom(request: Request): Promise<string | undefined> {
  if (request.method === "GET") return new URL(request.url).searchParams.get("end_date") ?? undefined;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_REQUEST_BYTES) throw new WhoopHistoryBackfillError("invalid_end_date");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES)
    throw new WhoopHistoryBackfillError("invalid_end_date");
  if (!text) return undefined;
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new WhoopHistoryBackfillError("invalid_end_date"); }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WhoopHistoryBackfillError("invalid_end_date");
  const fields = Object.keys(value);
  if (fields.some((field) => field !== "endDate")) throw new WhoopHistoryBackfillError("invalid_end_date");
  const endDate = (value as { endDate?: unknown }).endDate;
  if (endDate === undefined) return undefined;
  if (typeof endDate !== "string") throw new WhoopHistoryBackfillError("invalid_end_date");
  return endDate;
}

export async function handleWhoopHistoryBackfillRequest(request: Request,
  dependencies: RouteDependencies = defaultDependencies): Promise<Response> {
  const user = await dependencies.user();
  if (!user) return response({ error: "authentication_required" }, 401);
  const household = await dependencies.household(user);
  if (!household) return response({ error: "household_membership_required" }, 403);
  if (household.role !== "owner") return response({ error: "owner_access_required" }, 403);
  const memberId = await dependencies.memberId(household.householdId, user.userId);
  if (!memberId) return response({ error: "owner_member_required" }, 409);

  try {
    const endDate = await endDateFrom(request);
    const input = { householdId: household.householdId, memberId, timezone: household.timezone, endDate };
    if (request.method === "GET") return response(await dependencies.status(input));
    if (request.method === "POST") return response(await dependencies.run(input));
    return response({ error: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof WhoopHistoryBackfillError) {
      if (error.code === "invalid_end_date") return response({ error: error.code }, 400);
      if (error.code === "whoop_connection_required") return response({ error: error.code }, 409);
      console.error("WHOOP history backfill failed", { code: error.code });
      return response({ error: error.code, retryStartDate: error.retryStartDate }, 503);
    }
    console.error("WHOOP history backfill failed", { code: "unexpected" });
    return response({ error: "backfill_failed" }, 503);
  }
}

export function GET(request: Request) {
  return handleWhoopHistoryBackfillRequest(request);
}

export function POST(request: Request) {
  return handleWhoopHistoryBackfillRequest(request);
}
