
declare const useMemo: <T>(factory: () => T, deps: unknown[]) => T;
declare const formValues: { options: Array<{ label: string; selected: boolean }>; validationMin?: number; validationMax?: number };
declare function checkMinMax(count: number, min: number | undefined, max: number | undefined): boolean;

function CheckboxFieldSettingsExample() {
  const isValidationSatisfied = useMemo(() => {
    const preselectedOptions = (formValues.options || []).filter((option) => option.selected);

    if (formValues.validationMin !== undefined && preselectedOptions.length > 0) {
      return checkMinMax(preselectedOptions.length, formValues.validationMin, formValues.validationMax);
    }

    return true;
  }, [formValues]);

  return isValidationSatisfied;
}



// --- argument-type-mismatch FP: typed map callback with explicit parameter type annotations ---
interface CheckboxOption {
  id: string;
  label: string;
  checked: boolean;
  order: number;
}

declare const checkboxValues: CheckboxOption[] | undefined;

function CheckboxValueList() {
  return (
    <div>
      {checkboxValues?.map((item: CheckboxOption, index: number) => (
        <div key={item.id} style={{ order: index }}>
          <input type="checkbox" checked={item.checked} readOnly />
          <label>{item.label}</label>
        </div>
      ))}
    </div>
  );
}
