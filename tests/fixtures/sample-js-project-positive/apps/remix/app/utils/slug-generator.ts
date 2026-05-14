
// --- regex-duplicate-char-class FP: [̀-ͯ] is a single contiguous Unicode range ---
// Not a duplicate character class — it's one range for combining diacritical marks
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function generateTeamUrl(teamName: string): string {
  return slugify(teamName).slice(0, 30);
}
