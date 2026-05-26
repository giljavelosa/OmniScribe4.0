import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Keep these CJS-friendly outside the bundler:
  //  - @prisma/client is a runtime native client
  //  - bcryptjs runs at edge-incompatible nodejs runtime; keep external so server bundle stays clean
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  reactStrictMode: true,
  poweredByHeader: false,
  // Tighten the surface for accidental client/server boundary mistakes.
  typedRoutes: true,
  // Audio upload size — multipart body buffer for the impersonation
  // middleware (src/middleware.ts). Default is 10 MB; without raising
  // this, /api/notes/[id]/complete-stream and
  // /api/notes/[id]/upload-audio truncate the multipart body for any
  // recording over ~30 s of 16 kHz / 16-bit PCM, which then 500s on
  // `req.formData()` with "expected boundary after body". The
  // route-level MAX_AUDIO_BYTES caps already enforce the real limit
  // (60 MB for /complete-stream live capture, 200 MB for upload).
  // Setting this to the larger of the two gives both routes the
  // headroom they need.
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;
