
declare function getWebAppUrl(): string;

// Protocol stripping from base URL — /https?:\/\// is ASCII-only pattern.
export function formatWorkspaceUrl(workspaceUrl: string, baseUrl?: string): string {
  const formattedBase = (baseUrl ?? getWebAppUrl()).replace(/https?:\/\//, '');
  return `${formattedBase}/w/${workspaceUrl}`;
}
