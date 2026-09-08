import assert from "node:assert/strict";
import test from "node:test";
import {
  createHouseholdInvitation,
  createHouseholdJoinRequest,
  decideHouseholdJoinRequest,
  HouseholdAccessError,
  listHouseholdAccess,
  revokeHouseholdViewer,
} from "../db/household-access-store.ts";
import {
  createHouseholdForUser,
  canManageHouseholdMember,
  getHouseholdContext,
  householdHasMember,
  listManageableMemberIds,
  listHouseholdMembers,
} from "../db/household-store.ts";
import { createTestDatabase } from "./d1-test-helper.mjs";

const user = (id, email, name) => ({ userId: id, email, displayName: name, fullName: name });

async function rejectsWithCode(action, code) {
  await assert.rejects(action, (error) => error instanceof HouseholdAccessError && error.code === code);
}

test("creates isolated households for separate Site users", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const alex = user("user-alex", "alex@example.test", "Alex");
    const jordan = user("user-jordan", "jordan@example.test", "Jordan");
    const alexHousehold = await createHouseholdForUser(alex, { name: "Alex family", timezone: "UTC" }, db);
    const jordanHousehold = await createHouseholdForUser(jordan, { name: "Jordan family", timezone: "Asia/Shanghai" }, db);

    assert.notEqual(alexHousehold.householdId, jordanHousehold.householdId);
    assert.equal((await getHouseholdContext(alex, db))?.householdId, alexHousehold.householdId);
    assert.equal((await getHouseholdContext(jordan, db))?.householdId, jordanHousehold.householdId);
    assert.equal((await getHouseholdContext(jordan, db))?.timezone, "Asia/Shanghai");
    assert.equal((await listHouseholdMembers(alexHousehold.householdId, db)).length, 1);
    assert.equal((await listHouseholdMembers(jordanHousehold.householdId, db)).length, 1);
    assert.deepEqual(await listManageableMemberIds(alexHousehold, alex.userId, db),
      [(await listHouseholdMembers(alexHousehold.householdId, db))[0].id]);
    assert.equal(await householdHasMember(alexHousehold.householdId,
      (await listHouseholdMembers(jordanHousehold.householdId, db))[0].id, db), false);
  } finally {
    sqlite.close();
  }
});

test("requires an email-bound invitation and owner approval before membership", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const owner = user("user-owner", "owner@example.test", "Owner");
    const viewer = user("user-viewer", "viewer@example.test", "Viewer");
    const household = await createHouseholdForUser(owner, { name: "Owner family", timezone: "UTC" }, db);
    const invitation = await createHouseholdInvitation({
      householdId: household.householdId,
      invitedEmail: viewer.email,
      createdByUserId: owner.userId,
      now: 1_800_000_000_000,
    }, db);

    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM household_invitations WHERE token_digest = ?").get(invitation.token).count, 0);
    await rejectsWithCode(() => createHouseholdJoinRequest({
      user: user("wrong-user", "wrong@example.test", "Wrong"), token: invitation.token, now: 1_800_000_000_100,
    }, db), "invitation_email_mismatch");

    const request = await createHouseholdJoinRequest({ user: viewer, token: invitation.token, now: 1_800_000_000_200 }, db);
    assert.equal(request.status, "pending");
    assert.equal(await getHouseholdContext(viewer, db), null);
    assert.equal((await listHouseholdAccess(household.householdId, 1_800_000_000_300, db)).requests.length, 1);

    await decideHouseholdJoinRequest({
      householdId: household.householdId,
      requestId: request.id,
      decision: "approved",
      decidedByUserId: owner.userId,
      now: 1_800_000_000_400,
    }, db);
    assert.deepEqual(await getHouseholdContext(viewer, db), {
      householdId: household.householdId,
      role: "viewer",
      timezone: "UTC",
    });
    const householdMembers = await listHouseholdMembers(household.householdId, db);
    const viewerMember = householdMembers.find((member) => member.name === "Viewer");
    const ownerMember = householdMembers.find((member) => member.name === "Owner");
    assert.equal(householdMembers.length, 2);
    assert.ok(viewerMember);
    assert.ok(ownerMember);
    const viewerContext = await getHouseholdContext(viewer, db);
    assert.ok(viewerContext);
    assert.deepEqual(await listManageableMemberIds(viewerContext, viewer.userId, db), [viewerMember.id]);
    assert.equal(await canManageHouseholdMember(viewerContext, viewer.userId, viewerMember.id, db), true);
    assert.equal(await canManageHouseholdMember(viewerContext, viewer.userId, ownerMember.id, db), false);
    assert.equal(await canManageHouseholdMember(household, owner.userId, viewerMember.id, db), true);

    await revokeHouseholdViewer({
      householdId: household.householdId,
      viewerUserId: viewer.userId,
      ownerUserId: owner.userId,
      now: 1_800_000_000_500,
    }, db);
    assert.equal(await getHouseholdContext(viewer, db), null);
  } finally {
    sqlite.close();
  }
});

test("does not let one household approve another household's request", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const firstOwner = user("owner-one", "one@example.test", "One");
    const secondOwner = user("owner-two", "two@example.test", "Two");
    const requester = user("requester", "requester@example.test", "Requester");
    const first = await createHouseholdForUser(firstOwner, { name: "One family", timezone: "UTC" }, db);
    const second = await createHouseholdForUser(secondOwner, { name: "Two family", timezone: "UTC" }, db);
    const invitation = await createHouseholdInvitation({
      householdId: first.householdId,
      invitedEmail: requester.email,
      createdByUserId: firstOwner.userId,
    }, db);
    const request = await createHouseholdJoinRequest({ user: requester, token: invitation.token }, db);

    await rejectsWithCode(() => decideHouseholdJoinRequest({
      householdId: second.householdId,
      requestId: request.id,
      decision: "approved",
      decidedByUserId: secondOwner.userId,
    }, db), "join_request_invalid");
    assert.equal(await getHouseholdContext(requester, db), null);
  } finally {
    sqlite.close();
  }
});

test("does not approve expired requests and lets revoked viewers start separately", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const owner = user("owner-expiry", "owner-expiry@example.test", "Owner");
    const viewer = user("viewer-expiry", "viewer-expiry@example.test", "Viewer");
    const household = await createHouseholdForUser(owner, { name: "Original family", timezone: "UTC" }, db);
    const now = 1_800_000_000_000;
    const invitation = await createHouseholdInvitation({
      householdId: household.householdId,
      invitedEmail: viewer.email,
      createdByUserId: owner.userId,
      now,
    }, db);
    const request = await createHouseholdJoinRequest({ user: viewer, token: invitation.token, now: now + 1 }, db);

    await rejectsWithCode(() => decideHouseholdJoinRequest({
      householdId: household.householdId,
      requestId: request.id,
      decision: "approved",
      decidedByUserId: owner.userId,
      now: now + 8 * 24 * 60 * 60 * 1000,
    }, db), "join_request_invalid");

    await decideHouseholdJoinRequest({
      householdId: household.householdId,
      requestId: request.id,
      decision: "approved",
      decidedByUserId: owner.userId,
      now: now + 2,
    }, db);
    await revokeHouseholdViewer({
      householdId: household.householdId,
      viewerUserId: viewer.userId,
      ownerUserId: owner.userId,
      now: now + 3,
    }, db);
    const newHousehold = await createHouseholdForUser(viewer, { name: "Viewer family", timezone: "UTC" }, db);
    assert.notEqual(newHousehold.householdId, household.householdId);
    assert.equal((await getHouseholdContext(viewer, db))?.role, "owner");
  } finally {
    sqlite.close();
  }
});
