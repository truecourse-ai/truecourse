// getActivityLogPdf — thin-server FP shape with playwright and browser session
declare const DateTime_actLog: { now: () => { plus: (opts: { minutes: number }) => { toJSDate: () => { valueOf: () => number } } } };
declare const encryptPayload_actLog: (opts: { data: string; expiresAt: number }) => string;
declare const env_actLog: (key: string) => string | undefined;
declare const isValidLang_actLog: (lang?: string) => lang is string;
declare const USE_INTERNAL_URL_actLog: () => boolean;
declare const INTERNAL_WEBAPP_URL_actLog: () => string;
declare const PUBLIC_WEBAPP_URL_actLog: () => string;

type GetActivityLogPdfOptions = {
  contractId: number;
  language?: string;
};

export const getActivityLogPdf = async ({ contractId, language }: GetActivityLogPdfOptions) => {
  const { chromium } = await import('playwright');

  const encryptedId = encryptPayload_actLog({
    data: contractId.toString(),
    expiresAt: DateTime_actLog.now().plus({ minutes: 5 }).toJSDate().valueOf(),
  });

  let browser: import('playwright').Browser;

  const browserlessUrl = env_actLog('BROWSERLESS_URL');

  if (browserlessUrl) {
    browser = await chromium.connectOverCDP(browserlessUrl);
  } else {
    browser = await chromium.launch({
      executablePath: env_actLog('CHROMIUM_EXECUTABLE_PATH') || undefined,
    });
  }

  if (!browser) {
    throw new Error(
      'No browser available. Set BROWSERLESS_URL or CHROMIUM_EXECUTABLE_PATH to configure a browser.',
    );
  }

  const browserContext = await browser.newContext();
  const page = await browserContext.newPage();

  const lang = isValidLang_actLog(language) ? language : 'en';
  const baseUrl = USE_INTERNAL_URL_actLog() ? PUBLIC_WEBAPP_URL_actLog() : INTERNAL_WEBAPP_URL_actLog();

  await page.context().addCookies([
    { name: 'language', value: lang, url: baseUrl },
  ]);

  await page.goto(
    `${baseUrl}/__pdf/activity-log?c=${encryptedId}`,
    { waitUntil: 'networkidle', timeout: 10_000 },
  );

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
  });

  await browserContext.close();
  await browser.close();

  return pdfBuffer;
};
