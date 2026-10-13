import { retentionPolicy } from "../db/retention-policy";
import { dateInTimezone } from "./provider-sync";

export const HISTORY_BACKFILL_DAYS = 180;
export const HISTORY_BACKFILL_CHUNK_DAYS = 14;

export type HistoryBackfillRange = { startDate: string; endDate: string; days: number };

export class HistoryBackfillRangeError extends Error {
  constructor() {
    super("invalid_end_date");
  }
}

export function shiftHistoryDate(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HistoryBackfillRangeError();
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.valueOf()) || value.toISOString().slice(0, 10) !== date)
    throw new HistoryBackfillRangeError();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function historyBackfillRange(now: Date, timezone: string,
  requestedEndDate?: string): HistoryBackfillRange {
  const latestCompletedDate = shiftHistoryDate(dateInTimezone(now, timezone), -1);
  const endDate = requestedEndDate ?? latestCompletedDate;
  const oldestResumableEndDate = shiftHistoryDate(latestCompletedDate, -retentionPolicy.syncAttemptsDays);
  if (endDate > latestCompletedDate || endDate < oldestResumableEndDate)
    throw new HistoryBackfillRangeError();
  return { startDate: shiftHistoryDate(endDate, -(HISTORY_BACKFILL_DAYS - 1)), endDate,
    days: HISTORY_BACKFILL_DAYS };
}

export function historyChunkStarts(range: HistoryBackfillRange): string[] {
  const starts: string[] = [];
  for (let cursor = range.startDate; cursor <= range.endDate;
    cursor = shiftHistoryDate(cursor, HISTORY_BACKFILL_CHUNK_DAYS)) starts.push(cursor);
  return starts;
}
