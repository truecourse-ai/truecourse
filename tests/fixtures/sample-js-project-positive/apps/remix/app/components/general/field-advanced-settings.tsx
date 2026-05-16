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

function _longFn_0c181da9(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
