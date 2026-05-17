import type { TransactionalMessage } from '../transport';

export function buildPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
  expiresInHours: number;
}): TransactionalMessage {
  const text =
    `Hi,\n\n` +
    `We received a request to reset the password for this OmniScribe account.\n` +
    `Open this link within ${opts.expiresInHours} hour(s) to set a new password:\n\n` +
    `${opts.resetUrl}\n\n` +
    `If you didn't request this, you can safely ignore this email — your password stays unchanged.\n\n` +
    `— OmniScribe`;

  const html =
    `<p>Hi,</p>` +
    `<p>We received a request to reset the password for this OmniScribe account.</p>` +
    `<p><a href="${opts.resetUrl}">Set a new password</a> within ${opts.expiresInHours} hour(s).</p>` +
    `<p>If you didn't request this, you can safely ignore this email — your password stays unchanged.</p>` +
    `<p>— OmniScribe</p>`;

  return {
    to: opts.to,
    subject: 'Reset your OmniScribe password',
    html,
    text,
  };
}
