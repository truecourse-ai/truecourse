
// FP: async function with a simple guard clause — standard early-return
async function validateApiToken(inputToken: string): Promise<boolean> {
  if (!inputToken.startsWith('tok_')) {
    return false;
  }
  return true;
}
