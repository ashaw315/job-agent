import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type NotificationFrequency = "daily" | "weekdays" | "manual";

export interface NotificationPrefs {
  email: string;
  frequency: NotificationFrequency;
  paused: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  email: "",            // resolved at runtime via env if blank
  frequency: "daily",
  paused: false,
};

/**
 * Resolve notification preferences:
 * - Read settings.notifications. If absent, use DEFAULT_NOTIFICATIONS.
 * - If the email field is blank, fall back to process.env.NOTIFICATION_EMAIL.
 *
 * The returned email may still be blank if neither the DB nor env has one;
 * callers (digest sender, test route) must check before sending.
 */
export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const row = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "notifications"))
    .limit(1);

  let prefs: NotificationPrefs = DEFAULT_NOTIFICATIONS;
  if (row[0]) {
    try {
      const parsed = JSON.parse(row[0].value);
      prefs = { ...DEFAULT_NOTIFICATIONS, ...parsed };
    } catch {
      // Malformed JSON in the settings row — fall back to defaults.
    }
  }

  if (!prefs.email) {
    prefs = { ...prefs, email: process.env.NOTIFICATION_EMAIL ?? "" };
  }

  return prefs;
}
