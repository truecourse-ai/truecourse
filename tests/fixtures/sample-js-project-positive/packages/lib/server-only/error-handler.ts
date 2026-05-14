
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseError(error: any): { code: string; message: string } {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return { code: String(error.code), message: String(error.message ?? 'Unknown error') };
  }
  return { code: 'UNKNOWN_ERROR', message: String(error) };
}
