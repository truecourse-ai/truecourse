
// FF32 — useEffect with void executeAuthProcedure async-in-effect pattern
type AuthOpts = { method: string };
declare function runAuthenticatedProcedure(opts: {
  onReauthRequired: (opts: AuthOpts) => Promise<void>;
}): Promise<void>;
declare function useEffect(effect: () => void | (() => void), deps: unknown[]): void;
declare function populateDropdownOptions(opts: AuthOpts): Promise<void>;
declare const fieldId: string;

useEffect(() => {
  void runAuthenticatedProcedure({
    onReauthRequired: async (authOpts) => {
      await populateDropdownOptions(authOpts);
    },
  });
}, [fieldId]);



// --- argument-type-mismatch FP: selected.map to JSX elements array ---
interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

declare const selectedOptions: SelectOption[];

function SelectedBadgeList() {
  return (
    <div>
      {selectedOptions.map((option) => {
        return (
          <div key={option.value} className="badge">
            <span>{option.label}</span>
          </div>
        );
      })}
    </div>
  );
}
