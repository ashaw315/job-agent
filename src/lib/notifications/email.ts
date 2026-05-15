import { Resend } from "resend";

/**
 * Send a digest email via Resend.
 *
 * `from` is hard-coded to onboarding@resend.dev — Resend's default sender, which
 * works on a free account with no domain verification. To use a custom domain,
 * verify it in the Resend dashboard and update this constant.
 *
 * Throws when RESEND_API_KEY is unset or when Resend returns an error.
 */
export async function sendDigest(html: string, subject: string, to: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not set");
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: "job-agent <onboarding@resend.dev>",
    to,
    subject,
    html,
  });
  if (error) {
    throw new Error(`Resend error: ${error.name ?? "Unknown"} — ${error.message ?? "no message"}`);
  }
}
