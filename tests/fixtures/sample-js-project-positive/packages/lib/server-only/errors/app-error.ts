
// --- generic-error-message shape: server-500-security-fallback (conditional suppression) ---
// For non-500 responses the specific error.message surfaces; for 500-level
// errors 'Something went wrong' is returned intentionally to prevent internal
// detail leakage to external clients.
declare function getHttpStatus(errorCode: string): number;

function buildApiErrorBody(error: { code: string; message: string }) {
  const status = getHttpStatus(error.code);

  return {
    status,
    body: {
      message: status !== 500 ? error.message : 'Something went wrong',
    },
  };
}
