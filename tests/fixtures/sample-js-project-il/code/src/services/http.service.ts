import request from 'request';

// Spec mandates migrating off the deprecated `request` package to native
// fetch. It is still declared in package.json and used here.
// IL-DRIFT: ForbiddenArtifact:dependency.request / forbidden.dependency.request.present
export function fetchLegacy(url: string, cb: (err: unknown, body: string) => void): void {
  request(url, (err: unknown, _res: unknown, body: string) => cb(err, body));
}
