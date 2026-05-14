// github.com domain is fixed/canonical; the path is fully dynamic from gitConfig variables.
declare const gitConfig: { user: string; repo: string; branch: string; contentPath: string };
const githubEditUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${gitConfig.contentPath}`;
