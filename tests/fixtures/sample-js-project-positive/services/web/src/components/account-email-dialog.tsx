import { Button } from '@sample/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@sample/ui/primitives/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@sample/ui/primitives/form';
import { Input } from '@sample/ui/primitives/input';
import { useToast } from '@sample/ui/primitives/use-toast';

declare const React: { ReactNode: unknown };

export type AccountEmailDialogProps = {
  trigger: unknown;
  currentEmail: string;
  onSuccess?: () => void;
};

export function AccountEmailDialog(props: AccountEmailDialogProps): JSX.Element {
  const { trigger, currentEmail } = props;
  const { toast } = useToast();

  function handleSave(newEmail: string): void {
    if (!newEmail || newEmail === currentEmail) {
      toast({ title: 'No change', description: 'Email is already set to this value.' });
      return;
    }
    toast({ title: 'Saved', description: `Email updated to ${newEmail}.` });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger as JSX.Element}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Account Email</DialogTitle>
          <DialogDescription>Enter a new email address for your account.</DialogDescription>
        </DialogHeader>
        <Form onSubmit={(e: unknown) => void e}>
          <FormField name="email">
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" defaultValue={currentEmail} />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>
        </Form>
        <DialogFooter>
          <Button type="button" onClick={() => handleSave(currentEmail)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
