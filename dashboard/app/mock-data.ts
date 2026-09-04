export type Tone = "good" | "fair" | "low";
export type Source = "oura" | "whoop";

export type SleepStage = {
  stage: "REM" | "Light" | "Deep" | "Awake";
  minutes: number;
};

export type Contributor = {
  label: string;
  score: number | null;
  status: Tone;
};

export type Member = {
  id: string;
  name: string;
  initials: string;
  avatar: "green" | "amber" | "blue";
  sources: Source[];
  readiness: number | null;
  readinessAverage: number | null;
  recovery: number | null;
  overnightHrv: number | null;
  hrvBaseline: number | null;
  sleepAverageHeartRate: number | null;
  heartRateBaseline: number | null;
  sleepMinutes: number | null;
  deepSleepMinutes: number | null;
  strain: number | null;
  sleepStart: string;
  sleepEnd: string;
  contributors: Contributor[];
  stages: SleepStage[];
  readinessHistory: Array<number | null>;
};

const stages: SleepStage[] = [
  { stage: "Awake", minutes: 15 },
  { stage: "Light", minutes: 22 },
  { stage: "Deep", minutes: 34 },
  { stage: "Light", minutes: 19 },
  { stage: "REM", minutes: 14 },
  { stage: "Awake", minutes: 7 },
  { stage: "Light", minutes: 28 },
  { stage: "Deep", minutes: 30 },
  { stage: "REM", minutes: 38 },
  { stage: "Light", minutes: 29 },
  { stage: "Deep", minutes: 15 },
  { stage: "Light", minutes: 24 },
  { stage: "REM", minutes: 23 },
  { stage: "Awake", minutes: 12 },
  { stage: "Light", minutes: 26 },
  { stage: "REM", minutes: 19 },
  { stage: "Light", minutes: 23 },
];

const contributorSet = (variant: number): Contributor[] => [
  { label: "HRV balance", score: 38 + variant, status: variant > 15 ? "fair" : "low" },
  { label: "Resting heart rate", score: 55 + variant, status: "fair" },
  { label: "Sleep balance", score: 30 + variant, status: variant > 25 ? "fair" : "low" },
  { label: "Body temperature", score: 82, status: "good" },
  { label: "Previous day activity", score: 70 + variant / 2, status: "good" },
];

export const members: Member[] = [
  {
    id: "alex",
    name: "Alex",
    initials: "AL",
    avatar: "green",
    sources: ["oura", "whoop"],
    readiness: 87,
    readinessAverage: 82,
    recovery: 85,
    overnightHrv: 62,
    hrvBaseline: 58,
    sleepAverageHeartRate: 52,
    heartRateBaseline: 54,
    sleepMinutes: 462,
    deepSleepMinutes: 96,
    strain: 9.8,
    sleepStart: "10:41pm",
    sleepEnd: "6:51am",
    contributors: contributorSet(28),
    stages,
    readinessHistory: [85, 88, 83, 69, 86, 89, 87],
  },
  {
    id: "jordan",
    name: "Jordan",
    initials: "JD",
    avatar: "amber",
    sources: ["oura"],
    readiness: 61,
    readinessAverage: 78,
    recovery: null,
    overnightHrv: 38,
    hrvBaseline: 56,
    sleepAverageHeartRate: 61,
    heartRateBaseline: 57,
    sleepMinutes: 350,
    deepSleepMinutes: 85,
    strain: null,
    sleepStart: "11:48pm",
    sleepEnd: "6:12am",
    contributors: contributorSet(0),
    stages,
    readinessHistory: [68, 49, 65, 46, 67, 75, 61],
  },
  {
    id: "sam",
    name: "Sam",
    initials: "SM",
    avatar: "blue",
    sources: ["oura", "whoop"],
    readiness: 74,
    readinessAverage: 76,
    recovery: 74,
    overnightHrv: 49,
    hrvBaseline: 52,
    sleepAverageHeartRate: 56,
    heartRateBaseline: 55,
    sleepMinutes: 415,
    deepSleepMinutes: 88,
    strain: 11.2,
    sleepStart: "11:07pm",
    sleepEnd: "6:38am",
    contributors: contributorSet(18),
    stages,
    readinessHistory: [78, 80, 69, 77, 81, 76, 74],
  },
];

export const weekDays = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];

export function formatDuration(minutes: number | null) {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${rest}m`;
}

export function formatStrain(value: number | null) {
  return value === null ? "—" : value.toFixed(1);
}

export function readinessTone(score: number | null): Tone | "missing" {
  if (score === null) return "missing";
  if (score >= 70) return "good";
  if (score >= 55) return "fair";
  return "low";
}
