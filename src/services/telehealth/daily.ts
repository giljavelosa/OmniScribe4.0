import { randomBytes } from 'node:crypto';

/**
 * Daily.co stub-mode wrapper — Unit 15.
 *
 * Same pattern as Soniox / S3 / Bedrock / Stripe stubs (Units 03 / 05 /
 * 08 / 09): when `DAILY_API_KEY` is unset, createRoom returns a synthetic
 * `{ stub: true, ... }` result so the session lifecycle works end-to-end
 * in dev. Real-mode SDK call lives here too; v1 throws an explicit gap
 * error when DAILY_API_KEY is set without the integration finished —
 * better than silent failure or fake data.
 *
 * Pattern: single source of truth + exported config flag for the health
 * surface (Unit 09 /owner/health can pick this up alongside soniox /
 * bedrock / s3 / resend stubs).
 */

const SECRET_KEY = process.env.DAILY_API_KEY ?? '';
const BASE_URL = process.env.DAILY_BASE_URL ?? 'https://api.daily.co/v1';

export const dailyConfig = {
  isStubMode: !SECRET_KEY,
  baseUrl: BASE_URL,
};

export type CreateRoomInput = {
  sessionId: string;
  expiresAt: Date;
};

export type CreateRoomResult = {
  roomName: string;
  roomUrl: string;
  expiresAt: Date;
  stub: boolean;
};

export async function createRoom(input: CreateRoomInput): Promise<CreateRoomResult> {
  if (dailyConfig.isStubMode) {
    const suffix = randomBytes(4).toString('hex');
    const roomName = `stub-tele-${input.sessionId.slice(0, 8)}-${suffix}`;
    return {
      roomName,
      roomUrl: `https://stub.daily.co/${roomName}`,
      expiresAt: input.expiresAt,
      stub: true,
    };
  }
  throw new Error(
    'Real Daily.co path not yet implemented. Unset DAILY_API_KEY to use stub mode, or land the real integration before invoking this code path.',
  );
}

export async function destroyRoom(input: { roomName: string }): Promise<{ stub: boolean }> {
  if (dailyConfig.isStubMode) {
    return { stub: true };
  }
  void input;
  throw new Error(
    'Real Daily.co destroyRoom not yet implemented. See createRoom comment for the unblock path.',
  );
}
