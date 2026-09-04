import type { Metadata } from "next";
import { requireHouseholdUser } from "./household-auth";
import { WellnessDashboard } from "./wellness-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Household wellness",
  description: "A calm daily view of household sleep and recovery.",
};

async function ProtectedDashboard() {
  await requireHouseholdUser("/");
  return <WellnessDashboard />;
}

export default function Home() {
  return <ProtectedDashboard />;
}
