/**
 * SMS transport — mirrors the email stub pattern.
 *
 * Routing rules:
 *   1. TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM unset → console-stub.
 *   2. Otherwise → real Twilio send. Failures are loud (security-critical).
 */

type SmsMessage = {
  to: string;
  body: string;
};

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;

function twilioConfigured(): boolean {
  return !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM);
}

export async function sendTransactionalSms(msg: SmsMessage): Promise<void> {
  if (!twilioConfigured()) {
    console.log('\n────── 📱 SMS STUB (Twilio not configured) ──────');
    console.log(`to  : ${msg.to}`);
    console.log('--- body ---');
    console.log(msg.body);
    console.log('────── end ──────\n');
    return;
  }

  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const params = new URLSearchParams({
    To: msg.to,
    From: TWILIO_FROM!,
    Body: msg.body,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Twilio send failed (${res.status}): ${detail}`);
  }
}
