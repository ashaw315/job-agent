import { NextRequest, NextResponse } from "next/server";
import { buildAndSendDigest } from "@/lib/notifications/digest";
import { getNotificationPrefs } from "@/lib/settings/notifications";

/**
 * POST /api/digest/test
 *
 * Build and send today's digest immediately, bypassing the prefs gates
 * (paused, frequency=manual, weekend-on-weekdays). Used by the "Send test
 * digest" button in the Notifications tab.
 *
 * Body (optional): { email?: string } — overrides the configured recipient.
 * Without an override, uses the resolved getNotificationPrefs().email.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const override = typeof body?.email === "string" && body.email.trim() ? body.email.trim() : null;

    let to = override;
    if (!to) {
      const prefs = await getNotificationPrefs();
      to = prefs.email;
    }
    if (!to) {
      return NextResponse.json(
        { success: false, error: "No recipient email configured (set one in Notifications or NOTIFICATION_EMAIL env)." },
        { status: 400 }
      );
    }

    const result = await buildAndSendDigest(to);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("digest/test failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
