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
