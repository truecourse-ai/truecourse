
// --- argument-type-mismatch shape: react-ui-framework-apis (onOpenChange guard) ---
declare function useFormState(): { formState: { isSubmitting: boolean }; reset(): void };
declare function useDialogState(): [boolean, (v: boolean) => void];
declare const Dialog: React.FC<{ open?: boolean; onOpenChange?: (value: boolean) => void; children?: React.ReactNode }>;
declare const DialogTrigger: React.FC<{ asChild?: boolean; onClick?: (e: any) => void; children?: React.ReactNode }>;
declare const DialogContent: React.FC<{ position?: string; children?: React.ReactNode }>;
declare const Button: React.FC<{ className?: string; variant?: string; children?: React.ReactNode }>;
import * as React from 'react';

export function CreateTeamDialog(props: { trigger?: React.ReactNode }) {
  const form = useFormState();
  const [open, setOpen] = useDialogState();

  React.useEffect(() => {
    form.reset();
  }, [open]);

  return (
    <Dialog {...props} open={open} onOpenChange={(value) => !form.formState.isSubmitting && setOpen(value)}>
      <DialogTrigger onClick={(e) => e.stopPropagation()} asChild={true}>
        {props.trigger ?? (
          <Button className="flex-shrink-0" variant="secondary">
            Create team
          </Button>
        )}
      </DialogTrigger>
      <DialogContent position="center">
        {/* form content */}
      </DialogContent>
    </Dialog>
  );
}
