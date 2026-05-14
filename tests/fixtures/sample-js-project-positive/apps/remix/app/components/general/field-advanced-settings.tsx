declare const cn: (...args: unknown[]) => string;
declare const Switch: (props: { id?: string; checked?: boolean; onCheckedChange?: (v: boolean) => void; disabled?: boolean }) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode; className?: string }) => JSX.Element;
declare const Select: (props: { value?: string; onValueChange?: (v: string) => void; disabled?: boolean; children: React.ReactNode }) => JSX.Element;
declare const SelectTrigger: (props: { children: React.ReactNode; className?: string }) => JSX.Element;
declare const SelectContent: (props: { children: React.ReactNode }) => JSX.Element;
declare const SelectItem: (props: { value: string; children: React.ReactNode }) => JSX.Element;
declare const SelectValue: (props: { placeholder?: string }) => JSX.Element;
declare const Accordion: (props: { type: string; collapsible?: boolean; children: React.ReactNode; className?: string }) => JSX.Element;
declare const AccordionItem: (props: { value: string; children: React.ReactNode }) => JSX.Element;
declare const AccordionTrigger: (props: { children: React.ReactNode }) => JSX.Element;
declare const AccordionContent: (props: { children: React.ReactNode }) => JSX.Element;

type FieldFontSize = 'xs' | 'sm' | 'md' | 'lg';

type FieldAdvancedSettingsPanelProps = {
  isReadOnly: boolean;
  onReadOnlyChange: (v: boolean) => void;
  isRequired: boolean;
  onRequiredChange: (v: boolean) => void;
  fontSize: FieldFontSize;
  onFontSizeChange: (v: FieldFontSize) => void;
  disabled?: boolean;
};

export function FieldAdvancedSettingsPanel({
  isReadOnly,
  onReadOnlyChange,
  isRequired,
  onRequiredChange,
  fontSize,
  onFontSizeChange,
  disabled = false,
}: FieldAdvancedSettingsPanelProps) {
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="advanced">
        <AccordionTrigger>Advanced settings</AccordionTrigger>
        <AccordionContent>
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="field-required" className="text-sm font-medium">
                Required
              </Label>
              <Switch
                id="field-required"
                checked={isRequired}
                onCheckedChange={onRequiredChange}
                disabled={disabled}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="field-readonly" className="text-sm font-medium">
                Read only
              </Label>
              <Switch
                id="field-readonly"
                checked={isReadOnly}
                onCheckedChange={onReadOnlyChange}
                disabled={disabled}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-medium">Font size</Label>
              <Select value={fontSize} onValueChange={onFontSizeChange} disabled={disabled}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xs">Extra small</SelectItem>
                  <SelectItem value="sm">Small</SelectItem>
                  <SelectItem value="md">Medium</SelectItem>
                  <SelectItem value="lg">Large</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
