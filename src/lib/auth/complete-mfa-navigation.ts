/**
 * Hard-navigate after a successful MFA verify or setup finish.
 *
 * Why hard navigation instead of router.push + router.refresh:
 *   Next.js soft navigation sends a fetch to the RSC flight endpoint.
 *   The clinical layout's server component calls auth() which reads the
 *   JWT cookie — but the cookie write from session.update() may not have
 *   propagated yet when the RSC fetch lands. The layout sees
 *   mfaVerified=false and redirects back to /mfa-challenge, creating a
 *   loop. window.location.assign() forces a full page reload, so the
 *   browser always sends the current (updated) cookie on the new request.
 */
export async function completeMfaNavigation(
  update: (data: Record<string, unknown>) => Promise<unknown>,
  sessionPatch: Record<string, unknown>,
  destination: string,
): Promise<void> {
  await update(sessionPatch);
  window.location.assign(destination);
}
