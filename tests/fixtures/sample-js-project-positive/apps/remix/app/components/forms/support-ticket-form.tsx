declare const z: { object: (s: any) => any; string: () => { min: (n: number, msg: string) => any } };

const ZContactFormSchema = z.object({
  subject: z.string().min(3, 'Subject is required'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
  category: z.string().min(1, 'Category is required'),
});



// [unknown-catch-variable] catch binding never accessed — fixed toast shown instead
declare function submitContactRequest(opts: { subject: string; message: string; channelId: string }): Promise<void>;
declare const contactForm: { reset(): void; handleSubmit(fn: (data: { subject: string; message: string }) => Promise<void>): () => void };
declare const showToast: (opts: { title: string; description: string; variant?: string }) => void;
declare const channelId: string;
declare const onRequestComplete: (() => void) | undefined;

async function handleContactFormSubmit(data: { subject: string; message: string }): Promise<void> {
  try {
    await submitContactRequest({
      subject: data.subject,
      message: data.message,
      channelId,
    });

    showToast({
      title: 'Request submitted',
      description: 'Your message has been sent. We will respond shortly.',
    });

    onRequestComplete?.();
    contactForm.reset();
  } catch (err) {
    showToast({
      title: 'Failed to submit request',
      description: 'An error occurred. Please try again later.',
      variant: 'destructive',
    });
  }
}
