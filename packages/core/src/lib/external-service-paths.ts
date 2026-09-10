import path from 'node:path';
import type { DetectedExternalService } from '@truecourse/shared';

/** Keep detection portable across working copies and hosted scratch trees. */
export function relativeExternalServicePaths(
  services: readonly DetectedExternalService[],
  repoRoot: string,
): DetectedExternalService[] {
  const relative = (filePath: string): string => {
    const file = filePath.replace(/\\/g, '/');
    if (!path.posix.isAbsolute(file) && !path.win32.isAbsolute(file)) return file;
    const root = path.resolve(repoRoot).replace(/\\/g, '/').replace(/\/$/, '');
    if (file.startsWith(`${root}/`)) return file.slice(root.length + 1);

    // Older hosted reports retain a checkout that no longer exists. The run-clone
    // service owns this layout: run-clones/<workspace>/tc-run-<id>/<repo path>.
    const clone = file.match(/\/run-clones\/[^/]+\/tc-run-[^/]+\/(.+)$/);
    if (clone) return clone[1];
    return path.relative(repoRoot, filePath).split(path.sep).join('/');
  };
  return services.map((service) => ({
    ...service,
    evidence: service.evidence.map((evidence) => ({ ...evidence, filePath: relative(evidence.filePath) })),
    ...(service.credentialEnvs ? {
      credentialEnvs: service.credentialEnvs.map((credential) => ({
        ...credential,
        evidence: credential.evidence.map((evidence) => ({ ...evidence, filePath: relative(evidence.filePath) })),
      })),
    } : {}),
  }));
}
