
// shape: async function wraps ReactEmail.render call which already returns a Promise; async for interface method signature conformance
declare const ReactEmail: { render(el: unknown, opts?: unknown): Promise<string> };
declare function wrapWithI18N(el: unknown, locale: string): unknown;
declare function wrapWithBranding(el: unknown, branding: unknown): unknown;

type RenderWithI18NOptions = { branding?: unknown; i18n?: { locale: string } };

const renderEmailWithI18N = async (element: unknown, options?: RenderWithI18NOptions): Promise<string> => {
  const { branding, i18n, ...otherOptions } = options ?? {};

  if (!i18n) {
    throw new Error('i18n is required');
  }

  return ReactEmail.render(
    wrapWithI18N(wrapWithBranding(element, branding), i18n.locale),
    otherOptions,
  );
};



import * as ReactEmail from './react-email-render';

declare const WelcomeEmailTemplate: (props: { name: string; loginUrl: string }) => unknown;

export async function renderWelcomeEmail(name: string, loginUrl: string): Promise<string> {
  const html = await ReactEmail.render(
    WelcomeEmailTemplate({ name, loginUrl }),
  );

  return html;
}

export async function renderWelcomeEmailText(name: string, loginUrl: string): Promise<string> {
  const text = await ReactEmail.render(
    WelcomeEmailTemplate({ name, loginUrl }),
    { plainText: true } as ReactEmail.Options,
  );

  return text;
}
