import { and, asc, eq, isNull, max } from "drizzle-orm";
import type { ChatGPTUser } from "../app/chatgpt-auth";
import { parseAllowedEmails } from "../app/household-auth";
import { getDb, type Database } from "./index";
import { householdUsers, households, members } from "./schema";

export type HouseholdContext = {
  householdId: string;
  role: "owner" | "viewer";
  timezone: string;
};

export async function getHouseholdContext(
  user: ChatGPTUser,
  database?: Database,
): Promise<HouseholdContext | null> {
  const db = database ?? await getDb();
  const [row] = await db
    .select({ householdId: householdUsers.householdId, role: householdUsers.role, timezone: households.timezone })
    .from(householdUsers)
    .innerJoin(households, eq(householdUsers.householdId, households.id))
    .where(and(eq(householdUsers.siteUserId, user.userId), isNull(householdUsers.revokedAt)))
    .limit(1);
  return row ?? null;
}

export function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "ME";
}

export async function createHouseholdMember(
  householdId: string,
  displayName: string,
  database?: Database,
) {
  const name = displayName.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new Error("Member name is invalid.");
  const db = database ?? await getDb();
  const existing = await db.select({ id: members.id }).from(members)
    .where(and(eq(members.householdId, householdId), eq(members.active, true)));
  if (existing.length >= 12) throw new Error("Household member limit reached.");
  const [order] = await db.select({ value: max(members.displayOrder) }).from(members)
    .where(eq(members.householdId, householdId));
  const displayOrder = (order?.value ?? -1) + 1;
  const avatarKeys = ["green", "amber", "blue"] as const;
  const member = {
    id: crypto.randomUUID(),
    householdId,
    displayName: name,
    initials: initialsFor(name),
    avatarKey: avatarKeys[displayOrder % avatarKeys.length],
    displayOrder,
  };
  await db.insert(members).values(member);
  return { id: member.id, name: member.displayName, initials: member.initials, avatar: member.avatarKey };
}

export async function ensureOwnerHousehold(
  user: ChatGPTUser,
  database?: Database,
): Promise<HouseholdContext> {
  const db = database ?? await getDb();
  const existing = await getHouseholdContext(user, db);
  if (existing) return existing;

  const [ownerEmail] = parseAllowedEmails(process.env.WELLNESS_ALLOWED_EMAILS);
  if (user.email.trim().toLowerCase() !== ownerEmail) {
    throw new Error("Household membership has not been provisioned.");
  }

  const householdId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const displayName = (user.fullName ?? user.email.split("@")[0] ?? "Me").slice(0, 80);
  await db.batch([
    db.insert(households).values({
      id: householdId,
      name: "Family",
      timezone: process.env.WELLNESS_TIMEZONE || "UTC",
    }),
    db.insert(householdUsers).values({
      householdId,
      siteUserId: user.userId,
      role: "owner",
    }),
    db.insert(members).values({
      id: memberId,
      householdId,
      displayName,
      initials: initialsFor(displayName),
      avatarKey: "green",
      displayOrder: 0,
    }),
  ]);
  return { householdId, role: "owner", timezone: process.env.WELLNESS_TIMEZONE || "UTC" };
}

export async function listHouseholdMembers(
  householdId: string,
  database?: Database,
) {
  const db = database ?? await getDb();
  return db
    .select({
      id: members.id,
      name: members.displayName,
      initials: members.initials,
      avatar: members.avatarKey,
    })
    .from(members)
    .where(and(eq(members.householdId, householdId), eq(members.active, true)))
    .orderBy(asc(members.displayOrder));
}

export async function householdHasMember(
  householdId: string,
  memberId: string,
  database?: Database,
): Promise<boolean> {
  const db = database ?? await getDb();
  const [row] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.householdId, householdId), eq(members.id, memberId), eq(members.active, true)))
    .limit(1);
  return Boolean(row);
}
