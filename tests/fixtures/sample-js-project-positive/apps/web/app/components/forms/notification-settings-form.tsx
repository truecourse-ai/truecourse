
declare const Select: any;
declare const SelectTrigger: any;
declare const SelectValue: any;
declare const SelectContent: any;
declare const SelectItem: any;
declare const DEFAULT_NOTIFICATION_SETTINGS: any;

function NotificationInheritSelect({ field, canInherit }: { field: any; canInherit: boolean }) {
  if (!canInherit) return null;
  return (
    Select({
      value: field.value === null ? 'INHERIT' : 'CONTROLLED',
      onValueChange: (value: string) =>
        field.onChange(value === 'CONTROLLED' ? DEFAULT_NOTIFICATION_SETTINGS : null),
      children: [
        SelectTrigger({ children: SelectValue({}) }),
        SelectContent({
          children: [
            SelectItem({ value: 'INHERIT', children: 'Inherit from organisation' }),
            SelectItem({ value: 'CONTROLLED', children: 'Override organisation settings' }),
          ],
        }),
      ],
    })
  );
}
