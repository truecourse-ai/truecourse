
// --- FP shape: for loop with early-return after awaited comparison (TOTP window search) ---
declare function generateTimeWindowCode(secret: string, windowOffset: number): Promise<string>;

async function validateTimeBasedCode(secret: string, userCode: string, windowSize: number): Promise<boolean> {
  for (let offset = -windowSize; offset <= windowSize; offset++) {
    const code = await generateTimeWindowCode(secret, offset);
    if (code === userCode) return true;
  }
  return false;
}
