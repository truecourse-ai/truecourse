
declare function useForm<T>(opts: { defaultValues: Partial<T> }): { getValues: (field: string) => unknown; setValue: (field: string, value: unknown) => void };

type DropdownOption = { value: string };
type FormValues = { defaultValue?: string; values?: DropdownOption[]; required?: boolean };

const dropdownForm = useForm<FormValues>({ defaultValues: { values: [{ value: 'Option 1' }] } });

function addOption() {
  const currentValues = (dropdownForm.getValues('values') as DropdownOption[]) || [];

  let newLabel = 'New option';

  for (let i = 0; i < currentValues.length; i++) {
    const candidate = `New option ${i + 1}`;
    if (currentValues.some((item) => item.value === candidate)) {
      newLabel = candidate;
    } else {
      newLabel = candidate;
      break;
    }
  }

  const newValues = [...currentValues, { value: newLabel }];
  dropdownForm.setValue('values', newValues);
}

function removeOption(index: number) {
  const currentValues = (dropdownForm.getValues('values') as DropdownOption[]) || [];
  if (currentValues.length === 1) return;
  const newValues = [...currentValues];
  newValues.splice(index, 1);
  dropdownForm.setValue('values', newValues);
}
