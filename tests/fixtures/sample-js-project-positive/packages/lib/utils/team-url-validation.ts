
// --- regex-empty-repetition FP: (?:[-_][a-z0-9]+)* repeats a non-empty group ---
// The group (?:[-_][a-z0-9]+) can never match an empty string — * is not a repetition bug
const TEAM_URL_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

function isValidTeamUrl(url: string): boolean {
  if (url.length < 3 || url.length > 30) return false;
  return TEAM_URL_REGEX.test(url);
}

function validateTeamUrl(value: string): string | null {
  if (!isValidTeamUrl(value)) {
    return 'Team URL can only contain letters, numbers, dashes and underscores.';
  }
  return null;
}
