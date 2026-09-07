import { and, asc, eq, isNull, max } from "drizzle-orm";
import type { ChatGPTUser } from "../app/chatgpt-auth";
import { getDb, type Database } from "./index";
import { householdUsers, households, members } from "./schema";

export type HouseholdContext = {
  householdId: string;
  role: "owner" | "viewer";
  timezone: string;
};

export const HOUSEHOLD_AVATAR_COLORS = ["green", "amber", "blue", "plum", "coral", "teal"] as const;
export type HouseholdAvatarColor = typeof HOUSEHOLD_AVATAR_COLORS[number];

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

export async function requireHouseholdContext(
  user: ChatGPTUser,
  database?: Database,
): Promise<HouseholdContext> {
  const db = database ?? await getDb();
  const household = await getHouseholdContext(user, db);
  if (!household) throw new Error("Household membership is required.");
  await db.update(householdUsers).set({
    email: user.email.trim().toLowerCase(),
    displayName: (user.fullName ?? user.displayName).slice(0, 120),
  }).where(and(
    eq(householdUsers.householdId, household.householdId),
    eq(householdUsers.siteUserId, user.userId),
    isNull(householdUsers.revokedAt),
  ));
  return household;
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
  const member = {
    id: crypto.randomUUID(),
    householdId,
    displayName: name,
    initials: initialsFor(name),
    avatarKey: HOUSEHOLD_AVATAR_COLORS[displayOrder % HOUSEHOLD_AVATAR_COLORS.length] ?? "green",
    displayOrder,
  };
  await db.insert(members).values(member);
  return { id: member.id, name: member.displayName, initials: member.initials, avatar: member.avatarKey };
}

export async function updateHouseholdMember(
  householdId: string,
  memberId: string,
  input: { displayName: string; avatar: string },
  database?: Database,
) {
  const displayName = input.displayName.trim().replace(/\s+/g, " ");
  if (!displayName || displayName.length > 80) throw new Error("Member name is invalid.");
  if (!HOUSEHOLD_AVATAR_COLORS.includes(input.avatar as HouseholdAvatarColor))
    throw new Error("Avatar color is invalid.");
  const db = database ?? await getDb();
  const [existing] = await db.select({ id: members.id }).from(members)
    .where(and(eq(members.householdId, householdId), eq(members.id, memberId), eq(members.active, true))).limit(1);
  if (!existing) throw new Error("Household member was not found.");
  await db.update(members).set({ displayName, initials: initialsFor(displayName), avatarKey: input.avatar,
    updatedAt: Date.now() }).where(and(eq(members.householdId, householdId), eq(members.id, memberId)));
  return { id: memberId, name: displayName, initials: initialsFor(displayName), avatar: input.avatar };
}

export async function createHouseholdForUser(
  user: ChatGPTUser,
  input: { name: string; timezone: string },
  database?: Database,
): Promise<HouseholdContext> {
  const db = database ?? await getDb();
  const existing = await getHouseholdContext(user, db);
  if (existing) throw new Error("The user already belongs to a household.");

  const householdName = input.name.trim().replace(/\s+/g, " ");
  if (!householdName || householdName.length > 80) throw new Error("Household name is invalid.");
  const timezone = input.timezone.trim();
  if (!timezone || timezone.length > 64) throw new Error("Household timezone is invalid.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("Household timezone is invalid.");
  }

  const householdId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const displayName = (user.fullName ?? user.email.split("@")[0] ?? "Me").slice(0, 80);
  await db.batch([
    db.insert(households).values({
      id: householdId,
      name: householdName,
      timezone,
    }),
    db.insert(householdUsers).values({
      householdId,
      siteUserId: user.userId,
      role: "owner",
      email: user.email.trim().toLowerCase(),
      displayName: (user.fullName ?? user.displayName).slice(0, 120),
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
  return { householdId, role: "owner", timezone };
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
