
type RadioFieldOption = { id: number; value: string; selected: boolean };

function handleRadioOptionChange(
  index: number,
  property: 'value' | 'selected',
  newValue: string | boolean,
  options: RadioFieldOption[],
  setOptions: (opts: RadioFieldOption[]) => void,
) {
  const updated = [...options];

  if (property === 'selected') {
    updated[index].selected = Boolean(newValue);
  } else if (property === 'value') {
    updated[index].value = String(newValue);
  }

  setOptions(updated);
}
