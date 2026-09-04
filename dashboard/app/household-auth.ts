import { redirect } from "next/navigation";
import {
  getChatGPTUser,
  requireChatGPTUser,
  type ChatGPTUser,
} from "./chatgpt-auth";

const ACCESS_DENIED_PATH = "/access-denied";

export function parseAllowedEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedHouseholdUser(
  user: ChatGPTUser,
  configuredEmails = process.env.WELLNESS_ALLOWED_EMAILS,
): boolean {
  const allowedEmails = parseAllowedEmails(configuredEmails);
  return allowedEmails.has(user.email.trim().toLowerCase());
}

export async function getHouseholdUser(): Promise<ChatGPTUser | null> {
  const user = await getChatGPTUser();
  if (!user || !isAllowedHouseholdUser(user)) return null;
  return user;
}

export async function requireHouseholdUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await requireChatGPTUser(returnTo);
  if (!isAllowedHouseholdUser(user)) {
    redirect(ACCESS_DENIED_PATH);
  }
  return user;
}
