
// env() called with an infrastructure config key string — environment variable access
declare function env(key: string): string | undefined;

function getSmtpConfig() {
  const host = env('NEXT_PRIVATE_SMTP_HOST');
  const port = Number(env('NEXT_PRIVATE_SMTP_PORT')) || 587;
  const isSecure = env('NEXT_PRIVATE_SMTP_SECURE') === 'true';
  return { host, port, isSecure };
}
