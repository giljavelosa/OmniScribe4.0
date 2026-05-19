// One-off: print the current TOTP code for admin@demo.local (uses the
// seeded MFA secret). Convenience for local browser testing.
//
// otplib v13 dropped the `authenticator` singleton; use the named `generate`
// function instead — matches prisma/seed.ts and src/lib/mfa.ts.
import { generate } from 'otplib';

const SECRET = '7FSWEU6M2MYDQONC5WHDM72MK3FUQZ4Q';

(async () => {
  const code = await generate({ secret: SECRET });
  console.log(code);
  process.exit(0);
})();
