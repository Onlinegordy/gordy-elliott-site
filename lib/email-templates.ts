import { sendTrackedClientEmail } from "./tracked-client-email";
import { getSiteUrl } from "./site-url";
import { assertEmailAccepted, buildMigrationWelcomeEmail } from "./migration-welcome-email";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function getResend() {
  const { Resend } = await import("resend");
  return new Resend(process.env.RESEND_API_KEY!);
}
const FROM = process.env.RESEND_FROM_EMAIL || "AT CAPACITY <info@onlinegordy.com>";

function wrap(content: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
      ${content}
      <p style="color: #999; font-size: 12px; margin: 32px 0 0;">
        AT CAPACITY - Client Portal
      </p>
    </div>
  `;
}

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display: inline-block; background: #E040D0; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">${label}</a>`;
}

export async function sendWelcomeEmail(to: string, name: string, setupUrl: string, clientId?: string, programme?: string) {
  const programmeName = programme === "boardroom" ? "CAPACITY BOARDROOM" : "AT CAPACITY";
  const firstName = name.split(" ")[0];
  const resend = await getResend();
  const result = await sendTrackedClientEmail(to, "setup", (key) => resend.emails.send({
    from: FROM,
    to,
    subject: `Start your ${programmeName} setup`,
    html: wrap(`
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #111;">Welcome ${escapeHtml(firstName)},</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        Your ${programmeName} account is ready to set up. Choose your password and complete the consultation; ${programme === "boardroom" ? "Gordy will then prepare your coaching plan" : "your coach will then prepare your plan"} and switch on full access.
      </p>
      ${button(setupUrl, "Set Up Your Account")}
    `),
  }, { idempotencyKey: key }), clientId);
  assertEmailAccepted(result);
  return result;
}

// This dated migration message is deliberately separate from normal invitations.
// The caller retains a durable per-client send ledger as provider deduplication
// alone is time-limited. Reuse the same key and payload for a retry.
export async function sendMigrationWelcomeEmail(
  to: string,
  name: string,
  setupUrl: string,
  idempotencyKey: string,
  clientId?: string,
) {
  return sendPreparedMigrationWelcomeEmail(prepareMigrationWelcomeEmail(to, name, setupUrl), idempotencyKey, clientId);
}

export function prepareMigrationWelcomeEmail(to: string, name: string, setupUrl: string) {
  return { from: FROM, to, ...buildMigrationWelcomeEmail(name, setupUrl) };
}

export async function sendPreparedMigrationWelcomeEmail(
  message: ReturnType<typeof prepareMigrationWelcomeEmail>,
  idempotencyKey: string,
  clientId?: string,
) {
  if (!idempotencyKey.trim()) throw new Error("Migration email requires an idempotency key");
  const resend = await getResend();
  const result = await sendTrackedClientEmail(message.to, "migration", (key) => resend.emails.send(message, { idempotencyKey: key }), clientId, idempotencyKey);
  return assertEmailAccepted(result);
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string, setup = false, clientId?: string) {
  const firstName = name.split(" ")[0] || "there";
  const resend = await getResend(); const result = await sendTrackedClientEmail(to, setup ? "setup" : "password_reset", (key) => resend.emails.send({
    from: FROM,
    to,
    subject: setup ? "Your fresh AT CAPACITY setup link" : "Reset your AT CAPACITY password",
    html: wrap(`
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #111;">Hey ${escapeHtml(firstName)},</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        ${setup ? "Use the button below to finish setting up your account and choose a password." : "Use the button below to reset your portal password."} If you didn&apos;t ask for this, you can ignore this email.
      </p>
      ${button(resetUrl, setup ? "Finish Account Setup" : "Reset Password")}
    `),
  }, { idempotencyKey: key }), clientId);
  return assertEmailAccepted(result);
}

export async function sendCheckinReplyEmail(to: string, clientName: string, replyText: string, link = "/portal/inbox") {
  const firstName = clientName.split(" ")[0];
  const resend = await getResend(); return resend.emails.send({
    from: FROM,
    to,
    subject: "Gordy replied to your check-in",
    html: wrap(`
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #111;">Hey ${escapeHtml(firstName)},</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        Gordy has replied to your latest check-in.
      </p>
      <div style="background: #f8f8f6; border-left: 3px solid #E040D0; border-radius: 0 8px 8px 0; padding: 16px 20px; margin: 0 0 24px;">
        <p style="margin: 0; color: #333; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(replyText)}</p>
      </div>
      ${button(`${getSiteUrl()}${link}`, "Continue in DMs")}
    `),
  });
}

export async function sendCheckinReminderEmail(to: string, clientName: string, weekNumber: number) {
  const firstName = clientName.split(" ")[0];
  const resend = await getResend(); return resend.emails.send({
    from: FROM,
    to,
    subject: `Week ${weekNumber} check-in reminder`,
    html: wrap(`
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #111;">Hey ${escapeHtml(firstName)},</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        Your Week ${weekNumber} check-in is due. It takes 2 minutes and helps Gordy stay on top of your progress.
      </p>
      ${button(`${getSiteUrl()}/portal/checkin`, "Submit Check-In")}
    `),
  });
}

export async function sendConsultationLinkEmail(to: string, clientName: string, consultationUrl: string, clientId?: string, programme?: string) {
  const programmeName = programme === "boardroom" ? "CAPACITY BOARDROOM" : "AT CAPACITY";
  const firstName = clientName.split(" ")[0];
  const resend = await getResend(); const result = await sendTrackedClientEmail(to, "consultation", (key) => resend.emails.send({
    from: FROM,
    to,
    subject: `Complete your ${programmeName} consultation`,
    html: wrap(`
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #111;">Hey ${escapeHtml(firstName)},</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        Gordy has asked you to complete your consultation form so your coaching can be set up with the right context.
      </p>
      ${button(consultationUrl, "Complete Consultation")}
    `),
  }, { idempotencyKey: key }), clientId);
  assertEmailAccepted(result);
  return result;
}
