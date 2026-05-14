
declare function useFieldForm(defaults: any): any;
declare function useWatch(opts: any): any;

export function CheckboxFieldEditor({ fieldValue }: { fieldValue: any }) {
  const form = useFieldForm({
    mode: 'onChange',
    defaultValues: {
      label: fieldValue.label || '',
      options: fieldValue.options || [{ id: 1, selected: false, label: '' }],
      required: fieldValue.required || false,
    },
  });

  const { control } = form;
  const watched = useWatch({ control });

  const addOption = (count: number = 1) => {
    const current = form.getValues('options') || [];
    const maxId = Math.max(...current.map((o: any) => o.id));
    const newOpts = Array.from({ length: count }, (_: any, i: number) => ({
      id: maxId + i + 1,
      selected: false,
      label: '',
    }));
    form.setValue('options', [...current, ...newOpts]);
  };

  const removeOption = (index: number) => {
    const current = form.getValues('options') || [];
    if (current.length === 1) return;
    const updated = [...current];
    updated.splice(index, 1);
    form.setValue('options', updated);
  };

  return null;
}
