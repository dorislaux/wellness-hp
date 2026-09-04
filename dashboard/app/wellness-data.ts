import type { ChatGPTUser } from "./chatgpt-auth";
import { ensureOwnerHousehold } from "../db/household-store";
import { listHouseholdConnections, readHouseholdDailyData } from "../db/wellness-store";
import { members, readinessTone, type Contributor, type Member, type SleepStage } from "./mock-data";
import { syncHousehold } from "./provider-sync";

export type DataIssue = {
  memberId: string;
  source: "oura" | "whoop";
  code: "not_connected" | "not_current" | "unavailable";
  message: string;
};

export type WellnessSnapshot = {
  date: string;
  selection: string;
  title: string;
  dateLabel: string;
  dateOptions: Array<{ value: string; label: string }>;
  historyDates: string[];
  isAverage: boolean;
  emptyMessage: string | null;
  mode: "mock" | "sites";
  members: Member[];
  issues: DataIssue[];
};

const MOCK_DATE = "2026-08-10";
export const LAST_SEVEN_DAYS = "last7";

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function resolveDateSelection(value: string | undefined, currentDate: string): string {
  if (!value || value === LAST_SEVEN_DAYS) return LAST_SEVEN_DAYS;
  const earliest = shiftDate(currentDate, -6);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= earliest && value <= currentDate
    ? value : LAST_SEVEN_DAYS;
}

function dateOptions(currentDate: string) {
  return [
    { value: LAST_SEVEN_DAYS, label: "Last 7 days" },
    ...Array.from({ length: 7 }, (_, index) => {
      const value = shiftDate(currentDate, -index);
      const day = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
        .format(new Date(`${value}T12:00:00.000Z`));
      return { value, label: index === 0 ? `Today · ${day}` : day };
    }),
  ];
}

function periodLabels(selection: string, currentDate: string) {
  if (selection !== LAST_SEVEN_DAYS) {
    return {
      title: selection === currentDate ? "Today" : new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" })
        .format(new Date(`${selection}T12:00:00.000Z`)),
      dateLabel: new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
        .format(new Date(`${selection}T12:00:00.000Z`)),
    };
  }
  const startDate = shiftDate(currentDate, -6);
  const format = (value: string) => new Intl.DateTimeFormat("en", { month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00.000Z`));
  return { title: "7-day average", dateLabel: `${format(startDate)} – ${format(currentDate)}` };
}

function mockSnapshot(requestedSelection?: string): WellnessSnapshot {
  const selection = resolveDateSelection(requestedSelection, MOCK_DATE);
  const labels = periodLabels(selection, MOCK_DATE);
  return {
    date: MOCK_DATE,
    selection,
    ...labels,
    dateOptions: dateOptions(MOCK_DATE),
    historyDates: Array.from({ length: 7 }, (_, index) => shiftDate(MOCK_DATE, index - 6)),
    isAverage: selection === LAST_SEVEN_DAYS,
    emptyMessage: null,
    mode: "mock",
    members,
    issues: [
      {
        memberId: "jordan",
        source: "whoop",
        code: "not_connected",
        message: "WHOOP is not paired for Jordan.",
      },
    ],
  };
}

function average(values: Array<number | null>, digits = 0): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (!present.length) return null;
  const factor = 10 ** digits;
  return Math.round((present.reduce((sum, value) => sum + value, 0) / present.length) * factor) / factor;
}

function formatTime(value: number | null, timezone: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value)).toLowerCase();
}

function contributor(label: string, score: number | null): Contributor {
  const tone = readinessTone(score);
  return { label, score, status: tone === "missing" ? "low" : tone };
}

async function sitesSnapshot(user: ChatGPTUser, requestedSelection?: string): Promise<WellnessSnapshot> {
  const household = await ensureOwnerHousehold(user);
  const date = await syncHousehold(household.householdId, household.timezone);
  const selection = resolveDateSelection(requestedSelection, date);
  const isAverage = selection === LAST_SEVEN_DAYS;
  const periodStart = isAverage ? shiftDate(date, -6) : selection;
  const periodEnd = isAverage ? date : selection;
  const startDate = shiftDate(date, -29);
  const [{ members: storedMembers, records, stages }, connections] = await Promise.all([
    readHouseholdDailyData({ householdId: household.householdId, startDate, endDate: date,
      stageDate: isAverage ? date : selection }),
    listHouseholdConnections(household.householdId),
  ]);
  const issues: DataIssue[] = [];
  const liveMembers: Member[] = storedMembers.map((stored) => {
    const memberRecords = records.filter((item) => item.memberId === stored.id);
    const ouraRecords = memberRecords.filter((item) => item.provider === "oura");
    const periodRecords = memberRecords.filter((item) => item.localDate >= periodStart && item.localDate <= periodEnd);
    const activeOuraRecords = periodRecords.filter((item) => item.provider === "oura" && item.status === "complete");
    const activeWhoopRecords = periodRecords.filter((item) => item.provider === "whoop" && item.status === "complete");
    const sources = connections.filter((item) => item.memberId === stored.id && item.status !== "disconnected")
      .map((item) => item.provider);
    for (const source of ["oura", "whoop"] as const) {
      const sourceRecords = periodRecords.filter((item) => item.provider === source);
      if (!sources.includes(source)) issues.push({ memberId: stored.id, source, code: "not_connected",
        message: `${source === "oura" ? "Oura" : "WHOOP"} is not paired for ${stored.name}.` });
      else if (!sourceRecords.some((item) => item.status === "complete") && sourceRecords.some((item) => item.status === "unavailable"))
        issues.push({ memberId: stored.id, source, code: "unavailable",
        message: `${source === "oura" ? "Oura" : "WHOOP"} is temporarily unavailable for ${stored.name}.` });
      else if (!sourceRecords.some((item) => item.status === "complete")) issues.push({ memberId: stored.id, source, code: "not_current",
        message: isAverage
          ? `${source === "oura" ? "Oura" : "WHOOP"} has no complete data in this 7-day period for ${stored.name}.`
          : `${source === "oura" ? "Oura" : "WHOOP"} has not finished processing this date for ${stored.name}.` });
    }
    const historyDates = Array.from({ length: 7 }, (_, index) => shiftDate(date, index - 6));
    const sleepStages: SleepStage[] = isAverage ? [] : stages.filter((item) => item.memberId === stored.id).map((item) => ({
      stage: ({ rem: "REM", light: "Light", deep: "Deep", awake: "Awake" } as const)[item.stage],
      minutes: Math.round(item.durationSeconds / 60),
    }));
    const selectedOura = !isAverage ? activeOuraRecords[0] ?? null : null;
    const readiness = average(activeOuraRecords.map((item) => item.readinessScore));
    const overnightHrv = average(activeOuraRecords.map((item) => item.sleepAverageHrvMs));
    const sleepAverageHeartRate = average(activeOuraRecords.map((item) => item.sleepAverageHeartRateBpm), 1);
    return {
      id: stored.id, name: stored.name, initials: stored.initials,
      avatar: stored.avatar === "amber" || stored.avatar === "blue" ? stored.avatar : "green",
      sources, readiness,
      readinessAverage: average(ouraRecords.filter((item) => item.status === "complete").map((item) => item.readinessScore)),
      recovery: average(activeWhoopRecords.map((item) => item.recoveryScore)), overnightHrv,
      hrvBaseline: average(ouraRecords.filter((item) => item.status === "complete").map((item) => item.sleepAverageHrvMs)),
      sleepAverageHeartRate,
      heartRateBaseline: average(ouraRecords.filter((item) => item.status === "complete").map((item) => item.sleepAverageHeartRateBpm), 1),
      sleepMinutes: average(activeOuraRecords.map((item) => item.sleepTotalSeconds === null ? null : item.sleepTotalSeconds / 60)),
      deepSleepMinutes: average(activeOuraRecords.map((item) => item.deepSleepSeconds === null ? null : item.deepSleepSeconds / 60)),
      strain: average(activeWhoopRecords.map((item) => item.dayStrain), 1),
      sleepStart: formatTime(selectedOura?.sleepStartAt ?? null, household.timezone),
      sleepEnd: formatTime(selectedOura?.sleepEndAt ?? null, household.timezone),
      contributors: [contributor("HRV balance", average(activeOuraRecords.map((item) => item.hrvBalanceScore))),
        contributor("Resting heart rate", average(activeOuraRecords.map((item) => item.restingHeartRateContributorScore))),
        contributor("Sleep balance", average(activeOuraRecords.map((item) => item.sleepBalanceScore))),
        contributor("Body temperature", average(activeOuraRecords.map((item) => item.bodyTemperatureContributorScore))),
        contributor("Previous day activity", average(activeOuraRecords.map((item) => item.previousDayActivityScore)))],
      stages: sleepStages,
      readinessHistory: historyDates.map((day) => ouraRecords.find((item) => item.localDate === day && item.status === "complete")?.readinessScore ?? null),
    };
  });
  const empty = liveMembers.every((member) => member.readiness === null && member.recovery === null &&
    member.overnightHrv === null && member.sleepMinutes === null && member.strain === null);
  const labels = periodLabels(selection, date);
  const emptyMessage = !empty ? null : selection === date
    ? "Today’s data isn’t ready yet. Your connected devices synchronized successfully, but the providers have not finished processing today’s records."
    : "No complete data is available for this date. Choose another date or reconnect the affected device.";
  return { date, selection, ...labels, dateOptions: dateOptions(date),
    historyDates: Array.from({ length: 7 }, (_, index) => shiftDate(date, index - 6)),
    isAverage, emptyMessage, mode: "sites", members: liveMembers, issues };
}

export async function getWellnessSnapshot(user?: ChatGPTUser, selection?: string): Promise<WellnessSnapshot> {
  const mode = process.env.WELLNESS_DATA_MODE ?? "mock";
  if (mode === "mock") return mockSnapshot(selection);
  if (mode === "sites" && user) return sitesSnapshot(user, selection);
  throw new Error("Live Sites data requires an authenticated household user.");
}
