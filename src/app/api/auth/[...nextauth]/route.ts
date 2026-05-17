import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;

// bcrypt is not edge-compatible; force Node runtime.
export const runtime = 'nodejs';
