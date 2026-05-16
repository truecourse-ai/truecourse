
// c.get('requestMetadata') — Hono context accessor with a string key
declare const c: { get: (key: string) => unknown };

function extractRequestMetadata() {
  const metadata = c.get('requestMetadata');
  return metadata;
}



// safe-value-pass-no-property-access: catch(err) only console.error(err) and fixed toast; no property access
declare function sendEmailVerification(email: string): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleResendVerification(email: string): Promise<void> {
  try {
    await sendEmailVerification(email);
    showToast('Verification email sent', 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to send verification email. Please try again.', 'error');
  }
}



// catch-variable-never-accessed: catch(err) never accessed; block shows fixed toast without touching err
declare function signInWithOrgSso(orgUrl: string, credentials: Record<string, unknown>): Promise<{ token: string }>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleOrgSsoSignIn(orgUrl: string, credentials: Record<string, unknown>): Promise<string | null> {
  try {
    const result = await signInWithOrgSso(orgUrl, credentials);
    return result.token;
  } catch (err) {
    showToast('Sign in failed. Please check your credentials and try again.', 'error');
    return null;
  }
}
