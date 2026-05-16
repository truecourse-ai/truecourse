declare const field: { onChange: (v: string | null) => void; value: string | null };
declare function Select(props: any): any;
declare function SelectTrigger(props: any): any;
declare function SelectContent(props: any): any;
declare function SelectValue(props: any): any;
declare function SelectItem(props: any): any;

const VisibilitySelect = () => {
  return (
    <Select
      value={field.value === null ? '-1' : field.value}
      onValueChange={(value: string) => field.onChange(value === '-1' ? null : value)}
    >
      <SelectTrigger className="bg-background text-muted-foreground">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="PUBLIC">Everyone</SelectItem>
        <SelectItem value="PRIVATE">Only me</SelectItem>
        <SelectItem value="-1">Inherit from team</SelectItem>
      </SelectContent>
    </Select>
  );
};
