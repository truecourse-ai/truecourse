
// FP: onCopy={() => void onCopy('UTC', utcValue)} — intentional promise discard in callback prop.
// Not a void 0 case; void operator is used to discard an async onCopy's returned promise.
declare function onCopy(field: string, value: string): Promise<void>;
declare const React4: { createElement: (...args: unknown[]) => unknown };

type TimeRowProps = { label: string; value: string; isCopied: boolean; onCopyHandler: () => void };

function LocalTimeDisplay({ localTime, utcTime, unixTime }: { localTime: string; utcTime: string; unixTime: string }) {
  return React4.createElement('div', { className: 'space-y-1' },
    React4.createElement('div', {
      key: 'local',
      label: 'Local',
      value: localTime,
      onCopyHandler: () => void onCopy('Local', localTime),
    }),
    React4.createElement('div', {
      key: 'utc',
      label: 'UTC',
      value: utcTime,
      onCopyHandler: () => void onCopy('UTC', utcTime),
    }),
    React4.createElement('div', {
      key: 'unix',
      label: 'Unix',
      value: unixTime,
      onCopyHandler: () => void onCopy('Unix', unixTime),
    }),
  );
}
