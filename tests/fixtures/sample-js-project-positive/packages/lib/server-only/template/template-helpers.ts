
// FP shape: function body with try/catch and URL parsing (standard guard, not complex)
const parseRedirectUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.href;
  } catch {
    return null;
  }
};
