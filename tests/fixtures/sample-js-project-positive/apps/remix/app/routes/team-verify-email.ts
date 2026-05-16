
// Pass-through + boolean flag: catch(e) passes e to console.error and sets flag
async function verifyTeamEmailToken(token: string): Promise<{ verified: boolean }> {
  let verificationFailed = false;
  try {
    await confirmEmailVerificationToken(token);
  } catch (e) {
    console.error(e);
    verificationFailed = true;
  }
  return { verified: !verificationFailed };
}

declare function confirmEmailVerificationToken(token: string): Promise<void>;
