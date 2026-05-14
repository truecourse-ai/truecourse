declare function generateHOTP(secret: string, counter: number): Promise<string>;
declare function generateCredentials(opts: { email: string; id: string }): { secret: string };

const validateTwoFactorToken = async ({
  id,
  email,
  code,
  period = 30_000,
  window = 1,
}: {
  id: string;
  email: string;
  code: string;
  period?: number;
  window?: number;
}) => {
  const { secret } = generateCredentials({ email, id });

  let now = Date.now();

  for (let i = 0; i < window; i++) {
    const counter = Math.floor(now / period);
    const hotp = await generateHOTP(secret, counter);

    if (code === hotp) {
      return true;
    }

    now -= period;
  }

  return false;
};


// Promise.all with two overloaded render calls in parallel — valid, no type mismatch
declare function renderNotificationEmail(
  template: { subject: string; bodyHtml: string },
  opts: { locale: string; plainText?: boolean },
): Promise<string>;

declare const tokenExpiredTemplate: { subject: string; bodyHtml: string };
declare const renderOpts: { locale: string };

async function renderTokenExpiredEmailVariants() {
  const [htmlBody, plainBody] = await Promise.all([
    renderNotificationEmail(tokenExpiredTemplate, renderOpts),
    renderNotificationEmail(tokenExpiredTemplate, { ...renderOpts, plainText: true }),
  ]);

  return { html: htmlBody, plain: plainBody };
}

