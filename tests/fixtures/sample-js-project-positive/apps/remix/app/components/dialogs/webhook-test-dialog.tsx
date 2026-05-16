
declare const trpc: { notification: { testDelivery: { useMutation: () => { mutateAsync: (opts: { id: string; channel: string }) => Promise<void> } } } };
declare const useToast2: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const Dialog2: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; children?: React.ReactNode }>;
declare const DialogContent2: React.FC<{ children?: React.ReactNode }>;
declare const DialogHeader2: React.FC<{ children?: React.ReactNode }>;
declare const DialogTitle2: React.FC<{ children?: React.ReactNode }>;
declare const DialogDescription2: React.FC<{ children?: React.ReactNode }>;
declare const DialogFooter2: React.FC<{ children?: React.ReactNode }>;
declare const Form2: React.FC<{ children?: React.ReactNode; onSubmit?: React.FormEventHandler }>;
declare const FormField2: React.FC<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem2: React.FC<{ children?: React.ReactNode }>;
declare const FormLabel2: React.FC<{ children?: React.ReactNode }>;
declare const FormControl2: React.FC<{ children?: React.ReactNode }>;
declare const FormMessage2: React.FC<{ children?: React.ReactNode }>;
declare const Select2: React.FC<{ onValueChange?: (v: string) => void; value?: string; children?: React.ReactNode }>;
declare const SelectTrigger2: React.FC<{ children?: React.ReactNode }>;
declare const SelectContent2: React.FC<{ children?: React.ReactNode }>;
declare const SelectValue2: React.FC<{ placeholder?: string }>;
declare const SelectItem2: React.FC<{ value: string; children?: React.ReactNode }>;
declare const Button2: React.FC<{ type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children?: React.ReactNode }>;
declare const useForm2: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => void) => React.FormEventHandler; control: unknown; formState: { isSubmitting: boolean } };
declare const zodResolver2: (schema: unknown) => unknown;
declare const z2: { object: (shape: unknown) => unknown; string: () => { min: (n: number) => unknown } };
declare const useState2: <T>(v: T) => [T, (v: T) => void];
declare const React: { FC: unknown; ReactNode: unknown; FormEventHandler: unknown };

const DELIVERY_CHANNELS = ['email', 'sms', 'push', 'webhook'] as const;
type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

type NotificationTestDialogProps = {
  notification: { id: string; channels: DeliveryChannel[] };
  trigger: React.ReactNode;
};

export const NotificationTestDialog = ({ notification, trigger }: NotificationTestDialogProps) => {
  const { toast } = useToast2();

  const [open, setOpen] = useState2(false);

  const { mutateAsync: testDelivery } = trpc.notification.testDelivery.useMutation();

  const form = useForm2<{ channel: DeliveryChannel }>({
    defaultValues: { channel: notification.channels[0] },
  });

  const onSubmit = async ({ channel }: { channel: DeliveryChannel }) => {
    try {
      await testDelivery({ id: notification.id, channel });

      toast({ title: 'Test notification sent', description: `Sent via ${channel}` });
    } catch {
      toast({ title: 'Failed to send test notification', variant: 'destructive' });
    }
  };

  return (
    <Dialog2 open={open} onOpenChange={setOpen}>
      <span onClick={() => setOpen(true)}>{trigger}</span>

      <DialogContent2>
        <DialogHeader2>
          <DialogTitle2>Test Notification Delivery</DialogTitle2>
          <DialogDescription2>Select a channel to send a test notification through.</DialogDescription2>
        </DialogHeader2>

        <Form2 onSubmit={form.handleSubmit(onSubmit)}>
          <FormField2
            control={form.control}
            name="channel"
            render={({ field }) => (
              <FormItem2>
                <FormLabel2>Channel</FormLabel2>
                <FormControl2>
                  <Select2 value={(field as { value: string }).value} onValueChange={(field as { onChange: (v: string) => void }).onChange}>
                    <SelectTrigger2>
                      <SelectValue2 placeholder="Select channel" />
                    </SelectTrigger2>
                    <SelectContent2>
                      {notification.channels.map((ch) => (
                        <SelectItem2 key={ch} value={ch}>{ch}</SelectItem2>
                      ))}
                    </SelectContent2>
                  </Select2>
                </FormControl2>
                <FormMessage2 />
              </FormItem2>
            )}
          />

          <DialogFooter2>
            <Button2 type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button2>
            <Button2 type="submit" disabled={form.formState.isSubmitting}>Send Test</Button2>
          </DialogFooter2>
        </Form2>
      </DialogContent2>
    </Dialog2>
  );
};
