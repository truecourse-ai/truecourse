// Multi-line template literals are typically banners, CSS-in-JS, SQL, or
// generated reports — the multi-line shape means the outer template already
// reads vertically, so an inline nested template inside a substitution is
// not the readability hazard the rule is meant to catch (which is dense
// one-liner nests).

export function buildBootstrapBanner(
  groupName: string,
  token: string,
  tokenPath?: string,
): string {
  return `
==========================
Bootstrap - Worker Token

WARNING: This will only be shown once.

Worker group:
${groupName}

Token:
${token}
${
  tokenPath
    ? `Or, if using a file:
TOKEN=file://${tokenPath}`
    : ''
}
==========================
  `;
}
