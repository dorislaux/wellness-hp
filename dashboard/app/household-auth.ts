import { redirect } from "next/navigation";
import { getHouseholdContext } from "../db/household-store";
import {
  getChatGPTUser,
  requireChatGPTUser,
  type ChatGPTUser,
} from "./chatgpt-auth";

export async function getHouseholdUser(): Promise<ChatGPTUser | null> {
  const user = await getChatGPTUser();
  if (!user) return null;
  if ((process.env.WELLNESS_DATA_MODE ?? "mock") === "mock") return user;
  if (!(await getHouseholdContext(user))) return null;
  return user;
}

export async function requireHouseholdUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await requireChatGPTUser(returnTo);
  if ((process.env.WELLNESS_DATA_MODE ?? "mock") !== "mock" && !(await getHouseholdContext(user))) {
    redirect("/onboarding");
  }
  return user;
}
