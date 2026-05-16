// Single mailer file checks two distinct env var names — not duplicates of each other
function getSmtpConfig() {
  const host = process.env['SMTP_HOST'];
  const port = process.env['SMTP_PORT'];
  const user = process.env['SMTP_USER'];
  const pass = process.env['SMTP_PASSWORD'];

  if (!host || !port) {
    throw new Error('SMTP_HOST and SMTP_PORT are required');
  }

  return { host, port: parseInt(port, 10), user, pass };
}
