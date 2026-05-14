declare function createTransport(opts: any): any;
declare function env(key: string): string | undefined;

const buildSmtpTransport = () => {
  return createTransport({
    host: env('SMTP_HOST') ?? '127.0.0.1',
    port: Number(env('SMTP_PORT')) || 587,
    secure: env('SMTP_SECURE') === 'true',
    auth: env('SMTP_USERNAME')
      ? {
          user: env('SMTP_USERNAME'),
          pass: env('SMTP_PASSWORD') ?? '',
        }
      : undefined,
  });
};
