// One-off: print the current TOTP code for admin@demo.local (uses the
// seeded MFA secret). Convenience for local browser testing.
import { authenticator } from 'otplib';
const SECRET = '7FSWEU6M2MYDQONC5WHDM72MK3FUQZ4Q';
console.log(authenticator.generate(SECRET));
process.exit(0);
