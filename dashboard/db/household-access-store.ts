import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { ChatGPTUser } from "../app/chatgpt-auth";
import { getDb, type Database } from "./index";
import { retentionPolicy } from "./retention-policy";
import {
  householdInvitations,
  householdJoinRequests,
  householdUsers,
  households,
} from "./schema";

const INVITATION_TTL_MS = retentionPolicy.householdInvitationTtlDays * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_INVITATIONS = 25;
const encoder = new TextEncoder();

export type HouseholdAccessErrorCode =
  | "already_member"
  | "household_name_invalid"
  | "invitation_email_invalid"
  | "invitation_limit_reached"
  | "invitation_invalid"
  | "invitation_email_mismatch"
  | "join_request_pending"
  | "join_request_invalid"
  | "requester_already_member"
  | "viewer_invalid";

export class HouseholdAccessError extends Error {
  readonly code: HouseholdAccessErrorCode;

  constructor(code: HouseholdAccessErrorCode) {
    super(code);
    this.code = code;
  }
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HouseholdAccessError("invitation_email_invalid");
  }
  return email;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function createHouseholdInvitationToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashHouseholdInvitationToken(token: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new HouseholdAccessError("invitation_invalid");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createHouseholdInvitation(input: {
  householdId: string;
  invitedEmail: string;
  createdByUserId: string;
  now?: number;
}, database?: Database) {
  const db = database ?? await getDb();
  const now = input.now ?? Date.now();
  const invitedEmail = normalizeEmail(input.invitedEmail);
  const active = await db.select({ id: householdInvitations.id, invitedEmail: householdInvitations.invitedEmail })
    .from(householdInvitations).where(and(
    eq(householdInvitations.householdId, input.householdId),
    isNull(householdInvitations.claimedAt),
    isNull(householdInvitations.consumedAt),
    isNull(householdInvitations.revokedAt),
    gt(householdInvitations.expiresAt, now),
  ));
  if (active.filter((item) => item.invitedEmail !== invitedEmail).length >= MAX_ACTIVE_INVITATIONS) {
    throw new HouseholdAccessError("invitation_limit_reached");
  }

  const token = createHouseholdInvitationToken();
  const id = crypto.randomUUID();
  const expiresAt = now + INVITATION_TTL_MS;
  await db.batch([
    db.update(householdInvitations).set({ revokedAt: now }).where(and(
      eq(householdInvitations.householdId, input.householdId),
      eq(householdInvitations.invitedEmail, invitedEmail),
      isNull(householdInvitations.claimedAt),
      isNull(householdInvitations.consumedAt),
      isNull(householdInvitations.revokedAt),
    )),
    db.insert(householdInvitations).values({
      id,
      householdId: input.householdId,
      tokenDigest: await hashHouseholdInvitationToken(token),
      invitedEmail,
      createdByUserId: input.createdByUserId,
      expiresAt,
      createdAt: now,
    }),
  ]);
  return { id, token, invitedEmail, expiresAt };
}

export async function getPendingJoinRequest(userId: string, now = Date.now(), database?: Database) {
  const db = database ?? await getDb();
  const [request] = await db.select({
    id: householdJoinRequests.id,
    householdName: households.name,
    createdAt: householdJoinRequests.createdAt,
  }).from(householdJoinRequests)
    .innerJoin(households, eq(householdJoinRequests.householdId, households.id))
    .innerJoin(householdInvitations, eq(householdJoinRequests.invitationId, householdInvitations.id))
    .where(and(
      eq(householdJoinRequests.requesterUserId, userId),
      eq(householdJoinRequests.status, "pending"),
      gt(householdInvitations.expiresAt, now),
      isNull(householdInvitations.revokedAt),
    ))
    .orderBy(desc(householdJoinRequests.createdAt))
    .limit(1);
  return request ?? null;
}

export async function createHouseholdJoinRequest(input: {
  user: ChatGPTUser;
  token: string;
  now?: number;
}, database?: Database) {
  const db = database ?? await getDb();
  const now = input.now ?? Date.now();
  const [membership] = await db.select({ id: householdUsers.siteUserId }).from(householdUsers)
    .where(and(eq(householdUsers.siteUserId, input.user.userId), isNull(householdUsers.revokedAt))).limit(1);
  if (membership) throw new HouseholdAccessError("already_member");
  if (await getPendingJoinRequest(input.user.userId, now, db)) {
    throw new HouseholdAccessError("join_request_pending");
  }

  const tokenDigest = await hashHouseholdInvitationToken(input.token);
  const [invitation] = await db.select({
    id: householdInvitations.id,
    householdId: householdInvitations.householdId,
    invitedEmail: householdInvitations.invitedEmail,
    householdName: households.name,
  }).from(householdInvitations)
    .innerJoin(households, eq(householdInvitations.householdId, households.id))
    .where(and(
      eq(householdInvitations.tokenDigest, tokenDigest),
      gt(householdInvitations.expiresAt, now),
      isNull(householdInvitations.claimedAt),
      isNull(householdInvitations.consumedAt),
      isNull(householdInvitations.revokedAt),
    )).limit(1);
  if (!invitation) throw new HouseholdAccessError("invitation_invalid");
  if (invitation.invitedEmail !== input.user.email.trim().toLowerCase()) {
    throw new HouseholdAccessError("invitation_email_mismatch");
  }

  const id = crypto.randomUUID();
  await db.batch([
    db.update(householdInvitations).set({ claimedByUserId: input.user.userId, claimedAt: now })
      .where(and(eq(householdInvitations.id, invitation.id), isNull(householdInvitations.claimedAt))),
    db.insert(householdJoinRequests).values({
      id,
      householdId: invitation.householdId,
      invitationId: invitation.id,
      requesterUserId: input.user.userId,
      requesterEmail: input.user.email.trim().toLowerCase(),
      requesterDisplayName: (input.user.fullName ?? input.user.displayName).slice(0, 120),
      createdAt: now,
    }),
  ]);
  return { id, householdName: invitation.householdName, status: "pending" as const };
}

export async function listHouseholdAccess(householdId: string, now = Date.now(), database?: Database) {
  const db = database ?? await getDb();
  const [household, viewers, requests] = await Promise.all([
    db.select({ name: households.name }).from(households).where(eq(households.id, householdId)).limit(1),
    db.select({
      userId: householdUsers.siteUserId,
      email: householdUsers.email,
      displayName: householdUsers.displayName,
      joinedAt: householdUsers.createdAt,
    }).from(householdUsers).where(and(
      eq(householdUsers.householdId, householdId),
      eq(householdUsers.role, "viewer"),
      isNull(householdUsers.revokedAt),
    )),
    db.select({
      id: householdJoinRequests.id,
      email: householdJoinRequests.requesterEmail,
      displayName: householdJoinRequests.requesterDisplayName,
      requestedAt: householdJoinRequests.createdAt,
    }).from(householdJoinRequests)
      .innerJoin(householdInvitations, eq(householdJoinRequests.invitationId, householdInvitations.id))
      .where(and(
        eq(householdJoinRequests.householdId, householdId),
        eq(householdJoinRequests.status, "pending"),
        gt(householdInvitations.expiresAt, now),
        isNull(householdInvitations.revokedAt),
      )).orderBy(desc(householdJoinRequests.createdAt)),
  ]);
  return { householdName: household[0]?.name ?? "Household", viewers, requests };
}

export async function decideHouseholdJoinRequest(input: {
  householdId: string;
  requestId: string;
  decision: "approved" | "rejected";
  decidedByUserId: string;
  now?: number;
}, database?: Database) {
  const db = database ?? await getDb();
  const now = input.now ?? Date.now();
  const [request] = await db.select({
    id: householdJoinRequests.id,
    householdId: householdJoinRequests.householdId,
    invitationId: householdJoinRequests.invitationId,
    requesterUserId: householdJoinRequests.requesterUserId,
    requesterEmail: householdJoinRequests.requesterEmail,
    requesterDisplayName: householdJoinRequests.requesterDisplayName,
  }).from(householdJoinRequests)
    .innerJoin(householdInvitations, eq(householdJoinRequests.invitationId, householdInvitations.id))
    .where(and(
      eq(householdJoinRequests.id, input.requestId),
      eq(householdJoinRequests.householdId, input.householdId),
      eq(householdJoinRequests.status, "pending"),
      gt(householdInvitations.expiresAt, now),
      isNull(householdInvitations.consumedAt),
      isNull(householdInvitations.revokedAt),
    )).limit(1);
  if (!request) throw new HouseholdAccessError("join_request_invalid");

  const [existing] = await db.select({
    householdId: householdUsers.householdId,
  }).from(householdUsers).where(and(
    eq(householdUsers.siteUserId, request.requesterUserId),
    isNull(householdUsers.revokedAt),
  )).limit(1);
  if (input.decision === "approved" && existing) {
    throw new HouseholdAccessError("requester_already_member");
  }

  const updateRequest = db.update(householdJoinRequests).set({
    status: input.decision,
    decidedByUserId: input.decidedByUserId,
    decidedAt: now,
  }).where(and(eq(householdJoinRequests.id, input.requestId), eq(householdJoinRequests.status, "pending")));
  const consumeInvitation = db.update(householdInvitations).set({ consumedAt: now })
    .where(eq(householdInvitations.id, request.invitationId));
  if (input.decision === "approved") {
    const addViewer = db.insert(householdUsers).values({
      householdId: input.householdId,
      siteUserId: request.requesterUserId,
      role: "viewer",
      email: request.requesterEmail,
      displayName: request.requesterDisplayName,
      createdAt: now,
      revokedAt: null,
    }).onConflictDoUpdate({
      target: [householdUsers.householdId, householdUsers.siteUserId],
      set: {
        role: "viewer",
        email: request.requesterEmail,
        displayName: request.requesterDisplayName,
        revokedAt: null,
      },
    });
    await db.batch([addViewer, updateRequest, consumeInvitation]);
  } else {
    await db.batch([updateRequest, consumeInvitation]);
  }
}

export async function revokeHouseholdViewer(input: {
  householdId: string;
  viewerUserId: string;
  ownerUserId: string;
  now?: number;
}, database?: Database) {
  if (input.viewerUserId === input.ownerUserId) throw new HouseholdAccessError("viewer_invalid");
  const db = database ?? await getDb();
  const [viewer] = await db.select({ id: householdUsers.siteUserId }).from(householdUsers).where(and(
    eq(householdUsers.householdId, input.householdId),
    eq(householdUsers.siteUserId, input.viewerUserId),
    eq(householdUsers.role, "viewer"),
    isNull(householdUsers.revokedAt),
  )).limit(1);
  if (!viewer) throw new HouseholdAccessError("viewer_invalid");
  await db.update(householdUsers).set({ revokedAt: input.now ?? Date.now() }).where(and(
    eq(householdUsers.householdId, input.householdId),
    eq(householdUsers.siteUserId, input.viewerUserId),
    eq(householdUsers.role, "viewer"),
    isNull(householdUsers.revokedAt),
  ));
}
