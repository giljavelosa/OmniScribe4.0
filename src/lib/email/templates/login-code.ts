import type { TransactionalMessage } from '../transport';

export function buildLoginCodeEmail(opts: {
  to: string;
  code: string;
  expiresInMinutes: number;
}): TransactionalMessage {
  const text =
    `Your OmniScribe sign-in code is ${opts.code}.\n\n` +
    `It expires in ${opts.expiresInMinutes} minutes and can only be used once.\n\n` +
    `If you didn't try to sign in, you can ignore this email.\n\n` +
    `— OmniScribe`;

  const html =
    `<p>Your OmniScribe sign-in code is:</p>` +
    `<p style="font-size:24px;font-weight:600;letter-spacing:0.2em;font-family:monospace;">${opts.code}</p>` +
    `<p>It expires in ${opts.expiresInMinutes} minutes and can only be used once.</p>` +
    `<p>If you didn't try to sign in, you can ignore this email.</p>` +
    `<p>— OmniScribe</p>`;

  return {
    to: opts.to,
    subject: `${opts.code} is your OmniScribe sign-in code`,
    html,
    text,
  };
}
