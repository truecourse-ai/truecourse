
declare const onChange: (value: string[]) => void;
declare const value: string[];
declare const recipientId: string;

function handleCheckedChange(checked: boolean) {
  if (checked) {
    onChange([...value, recipientId]);
  } else {
    onChange(value.filter((v) => v !== recipientId));
  }
}
