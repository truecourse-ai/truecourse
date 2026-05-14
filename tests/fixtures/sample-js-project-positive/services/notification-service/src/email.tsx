// FP shape: render function called with JSX element tree — no type mismatch
import React from 'react';

interface I18nConfig { locale: string; messages: Record<string, string> }
interface EmailProps { subject: string; recipientName: string }

declare const EmailRenderer: { render: (element: React.ReactElement, opts?: { pretty?: boolean }) => Promise<string> };
declare const I18nProvider: React.ComponentType<{ i18n: I18nConfig; children: React.ReactNode }>;
declare const WelcomeEmail: React.ComponentType<EmailProps>;

async function renderWelcomeEmail(i18n: I18nConfig, props: EmailProps): Promise<string> {
  return EmailRenderer.render(
    <I18nProvider i18n={i18n}>
      <WelcomeEmail {...props} />
    </I18nProvider>
  );
}


// FP shape: downloadLink default parameter in a React email template component.
// Real URL is always injected by the caller; default is for Storybook/preview only.
interface ReportReadyEmailProps {
  recipientName: string;
  reportTitle: string;
  downloadLink?: string;
}

function ReportReadyEmail({
  recipientName,
  reportTitle,
  downloadLink = 'https://app.example.com/reports/preview/download',
}: ReportReadyEmailProps): JSX.Element {
  return (
    <div>
      <p>Hi {recipientName},</p>
      <p>Your report "{reportTitle}" is ready for download.</p>
      <a href={downloadLink}>Download Report</a>
    </div>
  );
}

export { ReportReadyEmail };



// hardcoded-url: inline URL used directly in email template — should be environment variable
declare function buildEmailHtml(body: string): string;

export function buildReportReadyEmail(recipientName: string, reportTitle: string): string {
  const reportUrl = 'https://app.truecourse.io/reports/preview/download';
  return buildEmailHtml(
    `Hi ${recipientName}, your report "${reportTitle}" is ready. Download at ${reportUrl}`,
  );
}

