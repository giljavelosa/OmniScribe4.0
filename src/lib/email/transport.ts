/**
 * Email transport (D3).
 *
 * Routing rules (in order):
 *   1. RESEND_API_KEY unset → console-stub (dev default; no account).
 *   2. RESEND_FROM domain is a dev placeholder (`*.local`, `*.test`,
 *      `*.localhost`, or `example.com`) → console-stub even if the
 *      API key is set. Resend rejects unverified domains with a
 *      hard 4xx that would otherwise blow up every signup, invite,
 *      and password-reset call. The dev probably wants the key
 *      ready for prod but hasn't verified a domain yet.
 *   3. Otherwise → real Resend send. NEVER silently swallows a
 *      real Resend failure (rule 8 spirit: loud failures over silent
 *      loss for security-critical email).
 */

import { Resend } from 'resend';

const FROM = process.env.RESEND_FROM ?? 'OmniScribe <noreply@omniscribe.local>';
const API_KEY = process.env.RESEND_API_KEY;

/** Dev placeholder domains that Resend will reject. Including them as
 *  the `from` strongly suggests the operator hasn't completed Resend's
 *  domain-verification flow yet — fall back to console-stub. */
const DEV_PLACEHOLDER_DOMAIN_SUFFIXES = ['.local', '.test', '.localhost', '@example.com'];

function fromDomainIsDevPlaceholder(): boolean {
  const lower = FROM.toLowerCase();
  return DEV_PLACEHOLDER_DOMAIN_SUFFIXES.some((suffix) => lower.includes(suffix));
}

let cachedResend: Resend | null = null;
function getResend() {
  if (!API_KEY) return null;
  if (fromDomainIsDevPlaceholder()) return null;
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
    // Stub mode — print everything so the dev can copy/paste links
    // (password-reset URLs, invite URLs, etc.) from the dev-server log.
    const reason = !API_KEY
      ? 'RESEND_API_KEY not set'
      : 'RESEND_FROM uses dev placeholder domain — Resend would reject';
    console.log(`\n────── ✉  EMAIL STUB (${reason}) ──────`);
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
