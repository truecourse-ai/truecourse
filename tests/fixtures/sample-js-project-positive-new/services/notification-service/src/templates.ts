export function renderEmail(subject: string, body: string): string {
  return `<h1>${subject}</h1><div>${body}</div>`;
}
export function renderWelcome(userName: string): string {
  return `<p>Hello ${userName}</p>`;
}
export function renderAlert(level: string, message: string): string {
  return `<strong>${level}</strong>: ${message}`;
}
