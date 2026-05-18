/**
 * Email transport (D3).
 *
 * If RESEND_API_KEY is set, sends via Resend. Otherwise logs the message to
 * the dev-server console — useful for local dev without a Resend account or
 * verified domain. NEVER silently swallows a real Resend failure (rule 8
 * spirit: loud failures over silent loss for security-critical email).
 */

import { Resend } from 'resend';

const FROM = process.env.RESEND_FROM ?? 'OmniScribe <noreply@omniscribe.local>';
const API_KEY = process.env.RESEND_API_KEY;

let cachedResend: Resend | null = null;
function getResend() {
  if (!API_KEY) return null;
  if (!cachedResend) cachedResend = new Resend(API_KEY);
  return cachedResend;
}

export type TransactionalMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendTransactional(msg: TransactionalMessage): Promise<void> {
  const resend = getResend();

  if (!resend) {
    // Stub mode — print everything so the dev can copy/paste links from logs.
    console.log('\n────── ✉  EMAIL STUB (RESEND_API_KEY not set) ──────');
    console.log(`from   : ${FROM}`);
    console.log(`to     : ${msg.to}`);
    console.log(`subject: ${msg.subject}`);
    console.log('--- text ---');
    console.log(msg.text);
    console.log('────── end ──────\n');
    return;
  }

  const r = await resend.emails.send({
    from: FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });

  if (r.error) {
    // Loud failure. The caller's audit log captures the attempt; the API route
    // returns 500 to the client (don't quietly drop a security-critical email).
    throw new Error(`Resend send failed: ${r.error.message ?? JSON.stringify(r.error)}`);
  }
}
