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
};

export default nextConfig;
