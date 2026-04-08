const TRUSTED_ORIGIN = 'https://app.example.com';
export function checkOrigin(origin: string): boolean {
  return origin === TRUSTED_ORIGIN;
}
export function sanitize(html: string): string {
  return html.replace(/<script.*?<\/script>/giu, '');
}
