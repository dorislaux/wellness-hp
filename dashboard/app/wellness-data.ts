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
  dateLabel: string;
  mode: "mock" | "sites";
  members: Member[];
  issues: DataIssue[];
};

const MOCK_DATE = "2026-08-10";

function mockSnapshot(): WellnessSnapshot {
  return {
    date: MOCK_DATE,
    dateLabel: "Monday, August 10",
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

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.round(present.reduce((sum, value) => sum + value, 0) / present.length) : null;
}

function formatTime(value: number | null, timezone: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value)).toLowerCase();
}

function contributor(label: string, score: number | null): Contributor {
  const tone = readinessTone(score);
  return { label, score, status: tone === "missing" ? "low" : tone };
}

async function sitesSnapshot(user: ChatGPTUser): Promise<WellnessSnapshot> {
  const household = await ensureOwnerHousehold(user);
  const date = await syncHousehold(household.householdId, household.timezone);
  const startDate = shiftDate(date, -29);
  const [{ members: storedMembers, records, stages }, connections] = await Promise.all([
    readHouseholdDailyData({ householdId: household.householdId, startDate, endDate: date }),
    listHouseholdConnections(household.householdId),
  ]);
  const issues: DataIssue[] = [];
  const liveMembers: Member[] = storedMembers.map((stored) => {
    const memberRecords = records.filter((item) => item.memberId === stored.id);
    const ouraRecords = memberRecords.filter((item) => item.provider === "oura");
    const todayOura = ouraRecords.find((item) => item.localDate === date);
    const todayWhoop = memberRecords.find((item) => item.provider === "whoop" && item.localDate === date);
    const sources = connections.filter((item) => item.memberId === stored.id && item.status !== "disconnected")
      .map((item) => item.provider);
    for (const source of ["oura", "whoop"] as const) {
      const current = source === "oura" ? todayOura : todayWhoop;
      if (!sources.includes(source)) issues.push({ memberId: stored.id, source, code: "not_connected",
        message: `${source === "oura" ? "Oura" : "WHOOP"} is not paired for ${stored.name}.` });
      else if (!current || current.status === "not_current") issues.push({ memberId: stored.id, source, code: "not_current",
        message: `${source === "oura" ? "Oura" : "WHOOP"} needs a current sync for ${stored.name}.` });
      else if (current.status === "unavailable") issues.push({ memberId: stored.id, source, code: "unavailable",
        message: `${source === "oura" ? "Oura" : "WHOOP"} is temporarily unavailable for ${stored.name}.` });
    }
    const activeOura = todayOura?.status === "complete" ? todayOura : null;
    const activeWhoop = todayWhoop?.status === "complete" ? todayWhoop : null;
    const historyDates = Array.from({ length: 7 }, (_, index) => shiftDate(date, index - 6));
    const sleepStages: SleepStage[] = stages.filter((item) => item.memberId === stored.id).map((item) => ({
      stage: ({ rem: "REM", light: "Light", deep: "Deep", awake: "Awake" } as const)[item.stage],
      minutes: Math.round(item.durationSeconds / 60),
    }));
    return {
      id: stored.id, name: stored.name, initials: stored.initials,
      avatar: stored.avatar === "amber" || stored.avatar === "blue" ? stored.avatar : "green",
      sources, readiness: activeOura?.readinessScore ?? null,
      readinessAverage: average(ouraRecords.filter((item) => item.status === "complete").map((item) => item.readinessScore)),
      recovery: activeWhoop?.recoveryScore ?? null, overnightHrv: activeOura?.sleepAverageHrvMs ?? null,
      hrvBaseline: average(ouraRecords.filter((item) => item.status === "complete").map((item) => item.sleepAverageHrvMs)),
      sleepAverageHeartRate: activeOura?.sleepAverageHeartRateBpm ?? null,
      heartRateBaseline: average(ouraRecords.filter((item) => item.status === "complete").map((item) => item.sleepAverageHeartRateBpm)),
      sleepMinutes: activeOura?.sleepTotalSeconds == null ? null : Math.round(activeOura.sleepTotalSeconds / 60),
      deepSleepMinutes: activeOura?.deepSleepSeconds == null ? null : Math.round(activeOura.deepSleepSeconds / 60),
      strain: activeWhoop?.dayStrain ?? null, sleepStart: formatTime(activeOura?.sleepStartAt ?? null, household.timezone),
      sleepEnd: formatTime(activeOura?.sleepEndAt ?? null, household.timezone),
      contributors: [contributor("HRV balance", activeOura?.hrvBalanceScore ?? null),
        contributor("Resting heart rate", activeOura?.restingHeartRateContributorScore ?? null),
        contributor("Sleep balance", activeOura?.sleepBalanceScore ?? null),
        contributor("Body temperature", activeOura?.bodyTemperatureContributorScore ?? null),
        contributor("Previous day activity", activeOura?.previousDayActivityScore ?? null)],
      stages: sleepStages,
      readinessHistory: historyDates.map((day) => ouraRecords.find((item) => item.localDate === day && item.status === "complete")?.readinessScore ?? null),
    };
  });
  const dateLabel = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00.000Z`));
  return { date, dateLabel, mode: "sites", members: liveMembers, issues };
}

export async function getWellnessSnapshot(user?: ChatGPTUser): Promise<WellnessSnapshot> {
  const mode = process.env.WELLNESS_DATA_MODE ?? "mock";
  if (mode === "mock") return mockSnapshot();
  if (mode === "sites" && user) return sitesSnapshot(user);
  throw new Error("Live Sites data requires an authenticated household user.");
}
