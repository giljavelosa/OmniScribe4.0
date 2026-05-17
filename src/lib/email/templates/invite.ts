import type { TransactionalMessage } from '../transport';

export function buildInviteEmail(opts: {
  to: string;
  orgName: string;
  invitedByName: string;
  onboardUrl: string;
  expiresInDays: number;
}): TransactionalMessage {
  const text =
    `Hi,\n\n` +
    `${opts.invitedByName} invited you to join ${opts.orgName} on OmniScribe.\n\n` +
    `Set up your account here (the link expires in ${opts.expiresInDays} day${
      opts.expiresInDays === 1 ? '' : 's'
    }):\n\n` +
    `${opts.onboardUrl}\n\n` +
    `If you weren't expecting this invitation, you can ignore this email.\n\n` +
    `— OmniScribe`;

  const html =
    `<p>Hi,</p>` +
    `<p><strong>${opts.invitedByName}</strong> invited you to join <strong>${opts.orgName}</strong> on OmniScribe.</p>` +
    `<p><a href="${opts.onboardUrl}">Set up your account</a> (expires in ${opts.expiresInDays} day${
      opts.expiresInDays === 1 ? '' : 's'
    }).</p>` +
    `<p>If you weren't expecting this invitation, you can ignore this email.</p>` +
    `<p>— OmniScribe</p>`;

  return {
    to: opts.to,
    subject: `${opts.invitedByName} invited you to ${opts.orgName} on OmniScribe`,
    html,
    text,
  };
}
