import type { ChatGPTUser } from "./chatgpt-auth";
import { ensureOwnerHousehold } from "../db/household-store";
import { listHouseholdConnections, readHouseholdDailyData } from "../db/wellness-store";
import { members as mockMembers, readinessTone, type Contributor, type Member } from "./mock-data";
import { dateInTimezone, syncHousehold } from "./provider-sync";

export type DataIssue = {
  memberId: string;
  source: "oura" | "whoop";
  code: "not_connected" | "not_current" | "unavailable";
  message: string;
};

export type RangeKey = "last7" | "last14" | "last30";

export type RangeView = {
  title: string;
  dateLabel: string;
  historyDates: string[];
  emptyMessage: string | null;
  members: Member[];
  issues: DataIssue[];
};

export type WellnessSnapshot = {
  date: string;
  mode: "mock" | "sites";
  canManageHousehold: boolean;
  rangeOptions: Array<{ value: RangeKey; label: string }>;
  ranges: Record<RangeKey, RangeView>;
};

const MOCK_DATE = "2026-08-10";
export const RANGE_OPTIONS: WellnessSnapshot["rangeOptions"] = [
  { value: "last7", label: "Last 7 days" },
  { value: "last14", label: "Last 14 days" },
  { value: "last30", label: "Last 30 days" },
];

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysForRange(range: RangeKey): number {
  return range === "last7" ? 7 : range === "last14" ? 14 : 30;
}

function periodLabel(currentDate: string, days: number): string {
  const startDate = shiftDate(currentDate, 1 - days);
  const format = (value: string) => new Intl.DateTimeFormat("en", {
    month: "long", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00.000Z`));
  return `${format(startDate)} – ${format(currentDate)}`;
}

function average(values: Array<number | null>, digits = 1): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (!present.length) return null;
  const factor = 10 ** digits;
  return Math.round((present.reduce((sum, value) => sum + value, 0) / present.length) * factor) / factor;
}

function contributor(label: string, score: number | null): Contributor {
  const tone = readinessTone(score);
  return { label, score, status: tone === "missing" ? "low" : tone };
}

function mockMembersForDays(days: number): Member[] {
  return mockMembers.map((member) => ({
    ...member,
    readinessHistory: Array.from({ length: days }, (_, index) =>
      member.readinessHistory[index % member.readinessHistory.length] ?? null),
  }));
}

function mockView(range: RangeKey): RangeView {
  const days = daysForRange(range);
  return {
    title: `${days}-day average`,
    dateLabel: periodLabel(MOCK_DATE, days),
    historyDates: Array.from({ length: days }, (_, index) => shiftDate(MOCK_DATE, index + 1 - days)),
    emptyMessage: null,
    members: mockMembersForDays(days),
    issues: [{ memberId: "jordan", source: "whoop", code: "not_connected", message: "WHOOP is not paired for Jordan." }],
  };
}

function mockSnapshot(): WellnessSnapshot {
  return {
    date: MOCK_DATE,
    mode: "mock",
    canManageHousehold: true,
    rangeOptions: RANGE_OPTIONS,
    ranges: { last7: mockView("last7"), last14: mockView("last14"), last30: mockView("last30") },
  };
}

type StoredData = Awaited<ReturnType<typeof readHouseholdDailyData>>;
type Connections = Awaited<ReturnType<typeof listHouseholdConnections>>;

function memberAvatar(value: string): Member["avatar"] {
  return (["green", "amber", "blue", "plum", "coral", "teal"] as const).includes(value as Member["avatar"])
    ? value as Member["avatar"] : "green";
}

function buildRangeView(input: {
  range: RangeKey;
  date: string;
  stored: StoredData;
  connections: Connections;
}): RangeView {
  const days = daysForRange(input.range);
  const periodStart = shiftDate(input.date, 1 - days);
  const historyDates = Array.from({ length: days }, (_, index) => shiftDate(input.date, index + 1 - days));
  const issues: DataIssue[] = [];
  const liveMembers: Member[] = input.stored.members.map((stored) => {
    const memberRecords = input.stored.records.filter((item) => item.memberId === stored.id);
    const ouraRecords = memberRecords.filter((item) => item.provider === "oura");
    const periodRecords = memberRecords.filter((item) => item.localDate >= periodStart && item.localDate <= input.date);
    const activeOuraRecords = periodRecords.filter((item) => item.provider === "oura" && item.status === "complete");
    const activeWhoopRecords = periodRecords.filter((item) => item.provider === "whoop" && item.status === "complete");
    const sources = input.connections.filter((item) => item.memberId === stored.id && item.status !== "disconnected")
      .map((item) => item.provider);

    for (const source of ["oura", "whoop"] as const) {
      const sourceRecords = periodRecords.filter((item) => item.provider === source);
      const providerName = source === "oura" ? "Oura" : "WHOOP";
      if (!sources.includes(source)) {
        issues.push({ memberId: stored.id, source, code: "not_connected", message: `${providerName} is not paired for ${stored.name}.` });
      } else if (!sourceRecords.some((item) => item.status === "complete") && sourceRecords.some((item) => item.status === "unavailable")) {
        issues.push({ memberId: stored.id, source, code: "unavailable", message: `${providerName} is temporarily unavailable for ${stored.name}.` });
      } else if (!sourceRecords.some((item) => item.status === "complete")) {
        issues.push({ memberId: stored.id, source, code: "not_current", message: `${providerName} has no complete data in this ${days}-day period for ${stored.name}.` });
      }
    }

    const readiness = average(activeOuraRecords.map((item) => item.readinessScore));
    const overnightHrv = average(activeOuraRecords.map((item) => item.sleepAverageHrvMs));
    const sleepAverageHeartRate = average(activeOuraRecords.map((item) => item.sleepAverageHeartRateBpm));
    return {
      id: stored.id,
      name: stored.name,
      initials: stored.initials,
      avatar: memberAvatar(stored.avatar),
      sources,
      readiness,
      readinessAverage: average(ouraRecords.filter((item) => item.status === "complete").map((item) => item.readinessScore)),
      recovery: average(activeWhoopRecords.map((item) => item.recoveryScore)),
      overnightHrv,
      hrvBaseline: average(ouraRecords.filter((item) => item.status === "complete").map((item) => item.sleepAverageHrvMs)),
      sleepAverageHeartRate,
      heartRateBaseline: average(ouraRecords.filter((item) => item.status === "complete").map((item) => item.sleepAverageHeartRateBpm)),
      sleepMinutes: average(activeOuraRecords.map((item) => item.sleepTotalSeconds === null ? null : item.sleepTotalSeconds / 60)),
      deepSleepMinutes: average(activeOuraRecords.map((item) => item.deepSleepSeconds === null ? null : item.deepSleepSeconds / 60)),
      dailyCalories: average(activeOuraRecords.map((item) => item.totalCalories)),
      strain: average(activeWhoopRecords.map((item) => item.dayStrain)),
      sleepStart: "—",
      sleepEnd: "—",
      contributors: [
        contributor("HRV balance", average(activeOuraRecords.map((item) => item.hrvBalanceScore))),
        contributor("Resting heart rate", average(activeOuraRecords.map((item) => item.restingHeartRateContributorScore))),
        contributor("Sleep balance", average(activeOuraRecords.map((item) => item.sleepBalanceScore))),
        contributor("Body temperature", average(activeOuraRecords.map((item) => item.bodyTemperatureContributorScore))),
        contributor("Previous day activity", average(activeOuraRecords.map((item) => item.previousDayActivityScore))),
      ],
      stages: [],
      readinessHistory: historyDates.map((day) =>
        ouraRecords.find((item) => item.localDate === day && item.status === "complete")?.readinessScore ?? null),
    };
  });

  const empty = liveMembers.every((member) => member.readiness === null && member.recovery === null &&
    member.overnightHrv === null && member.sleepMinutes === null && member.dailyCalories === null && member.strain === null);
  return {
    title: `${days}-day average`,
    dateLabel: periodLabel(input.date, days),
    historyDates,
    emptyMessage: empty
      ? `No complete data is available for the last ${days} days. Your connected devices will refresh automatically.`
      : null,
    members: liveMembers,
    issues,
  };
}

async function sitesSnapshot(user: ChatGPTUser, refresh: boolean): Promise<WellnessSnapshot> {
  const household = await ensureOwnerHousehold(user);
  const date = refresh
    ? await syncHousehold(household.householdId, household.timezone)
    : dateInTimezone(new Date(), household.timezone);
  const startDate = shiftDate(date, -29);
  const [stored, connections] = await Promise.all([
    readHouseholdDailyData({ householdId: household.householdId, startDate, endDate: date }),
    listHouseholdConnections(household.householdId),
  ]);
  return {
    date,
    mode: "sites",
    canManageHousehold: household.role === "owner",
    rangeOptions: RANGE_OPTIONS,
    ranges: {
      last7: buildRangeView({ range: "last7", date, stored, connections }),
      last14: buildRangeView({ range: "last14", date, stored, connections }),
      last30: buildRangeView({ range: "last30", date, stored, connections }),
    },
  };
}

export async function getWellnessSnapshot(user?: ChatGPTUser, options: { refresh?: boolean } = {}): Promise<WellnessSnapshot> {
  const mode = process.env.WELLNESS_DATA_MODE ?? "mock";
  if (mode === "mock") return mockSnapshot();
  if (mode === "sites" && user) return sitesSnapshot(user, options.refresh === true);
  throw new Error("Live Sites data requires an authenticated household user.");
}
