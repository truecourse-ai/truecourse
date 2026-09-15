/** The logo and wordmark, the one place the UI uses the logo's font. */

const WORDMARK = {
  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  letterSpacing: '0.01em',
} as const;

const MARK = { 6: 'h-6 w-6', 7: 'h-7 w-7' } as const;

export function Brand({ size = 7 }: { size?: keyof typeof MARK }) {
  return (
    <>
      <img src="/logo.svg" alt="" className={`${MARK[size]} shrink-0 dark:hidden`} />
      <img src="/logo-dark.svg" alt="" className={`hidden ${MARK[size]} shrink-0 dark:block`} />
      <span className="text-sm font-bold" style={WORDMARK}>
        TrueCourse
      </span>
    </>
  );
}
