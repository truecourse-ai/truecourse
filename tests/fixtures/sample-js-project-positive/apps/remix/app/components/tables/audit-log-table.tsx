
declare function _<T>(msg: T): T;
declare function formatBrowserInfo(userAgent: string | null, info: Record<string, string>): string;
declare const log: { userAgent: string | null };
declare const browserInfo: Record<string, string>;

function renderUserAgent() {
  return _(formatBrowserInfo(log.userAgent, browserInfo));
}



declare function _<T>(msg: T): T;
declare const ROLE_DISPLAY_NAMES: Record<string, { label: string }>;
declare const participant: { role: string };

function renderParticipantRole() {
  return _(ROLE_DISPLAY_NAMES[participant.role].label);
}



// --- argument-type-mismatch FP: Lingui _ macro receiving a MessageDescriptor ---
declare function _(descriptor: { id: string; message?: string }): string;
declare function msg(strings: TemplateStringsArray): { id: string; message: string };

const STATUS_LABELS: Record<string, string> = {
  active: _(msg`Active`),
  inactive: _(msg`Inactive`),
  pending: _(msg`Pending`),
  archived: _(msg`Archived`),
};
