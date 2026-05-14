
declare function _<T>(msg: T): T;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): string;
declare const log: { ipAddress: string | null };

function renderIpAddress() {
  return _(msg`IP Address`);
}

function renderLogIpAddress() {
  return log.ipAddress || _(msg`Unknown`);
}
