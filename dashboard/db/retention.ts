import { and, eq, lt } from "drizzle-orm";
import { retentionPolicy } from "./retention-policy";
import { getDb, type Database } from "./index";
import { dailySourceRecords, members, oauthSessions, providerConnections, sleepStageSegments, syncAttempts } from "./schema";

const HOUR_MS = 60 * 60 * 1000;

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function enforceRetention(localDate: string, now = Date.now(), database?: Database) {
  const db = database ?? await getDb();
  await db.batch([
    db.delete(oauthSessions).where(lt(oauthSessions.createdAt,
      now - retentionPolicy.oauthSessionCleanupHours * HOUR_MS)),
    db.delete(dailySourceRecords).where(lt(dailySourceRecords.localDate,
      shiftDate(localDate, -retentionPolicy.normalizedDailyMetricsDays))),
    db.delete(sleepStageSegments).where(lt(sleepStageSegments.localDate,
      shiftDate(localDate, -retentionPolicy.sleepStageSegmentsDays))),
    db.delete(syncAttempts).where(lt(syncAttempts.startedAt,
      now - retentionPolicy.syncAttemptsDays * 24 * HOUR_MS)),
    db.delete(providerConnections).where(and(eq(providerConnections.status, "disconnected"),
      lt(providerConnections.disconnectedAt, now - retentionPolicy.disconnectedConnectionMetadataDays * 24 * HOUR_MS))),
    db.delete(members).where(and(eq(members.active, false),
      lt(members.updatedAt, now - retentionPolicy.deletedMemberDataCleanupHours * HOUR_MS))),
  ]);
}
