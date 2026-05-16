declare const field: { onChange: (v: string) => void; value: string; disabled: boolean };
declare function handleAutoSave(): Promise<void>;
declare function Select(props: any): any;
declare const SUPPORTED_LOCALES: Record<string, string>;

const LocaleSelect = () => {
  return (
    <Select
      value={field.value}
      disabled={field.disabled}
      onValueChange={(value: string) => {
        field.onChange(value);
        void handleAutoSave();
      }}
    >
      {Object.entries(SUPPORTED_LOCALES).map(([code, label]) => (
        <option key={code} value={code}>{label}</option>
      ))}
    </Select>
  );
};
