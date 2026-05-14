
declare const TIMEZONE_OPTIONS: { label: string; value: string }[];
declare function useTimezone(): { current: string };

function getDefaultTimezoneOption() {
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const matched = TIMEZONE_OPTIONS.find((opt) => opt.value === browserTimezone);
  return matched ?? TIMEZONE_OPTIONS[0];
}

function TimezoneSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const defaultOption = getDefaultTimezoneOption();
  return null;
}
