
declare function getEnv(key: string): string | undefined;

const getEmailTransport = () => {
  const provider = getEnv('MAIL_TRANSPORT_PROVIDER') ?? 'smtp';

  if (provider === 'sendgrid') {
    return { type: 'sendgrid', apiKey: getEnv('SENDGRID_API_KEY') };
  }

  if (provider === 'ses') {
    return { type: 'ses', region: getEnv('AWS_REGION') ?? 'us-east-1' };
  }

  return { type: 'smtp', host: getEnv('SMTP_HOST') ?? 'localhost', port: 587 };
};

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
