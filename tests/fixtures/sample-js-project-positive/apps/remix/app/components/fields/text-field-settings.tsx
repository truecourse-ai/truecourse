
// FF04 — JSX onValueChange callback forwarding string value; types match
declare function Select(props: {
  value?: string;
  onValueChange?: (value: string) => void;
  children: unknown;
}): JSX.Element;
declare function SelectContent(props: { children: unknown }): JSX.Element;
declare function SelectItem(props: { value: string; children: unknown }): JSX.Element;
declare function handleFieldSetting(key: string, value: string): void;

function AlignmentSelector() {
  return (
    <Select onValueChange={(value) => handleFieldSetting('textAlign', value)}>
      <SelectContent>
        <SelectItem value="left">Left</SelectItem>
        <SelectItem value="center">Center</SelectItem>
        <SelectItem value="right">Right</SelectItem>
      </SelectContent>
    </Select>
  );
}
