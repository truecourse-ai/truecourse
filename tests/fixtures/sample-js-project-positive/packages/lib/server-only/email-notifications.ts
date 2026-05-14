
// --- unknown-catch-variable shape: catch(e) never accessed; comment-only catch swallows email errors ---
declare function sendRevocationEmail(opts: { to: string; teamName: string }): Promise<void>;
declare function performRevocation(teamId: string): Promise<void>;

async function revokeTeamEmailAccess(teamId: string, ownerEmail: string, teamName: string) {
  await performRevocation(teamId);

  try {
    await sendRevocationEmail({ to: ownerEmail, teamName });
  } catch (e) {
    // We don't want to prevent revocation because a notification email could not be sent.
  }
}
