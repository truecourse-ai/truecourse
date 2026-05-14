declare const Button: (props: { children: React.ReactNode; onClick?: () => void; variant?: string; size?: string; type?: string; disabled?: boolean }) => JSX.Element;
declare const Input: (props: { id?: string; type?: string; placeholder?: string; value?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; className?: string }) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode }) => JSX.Element;
declare const Badge: (props: { children: React.ReactNode; variant?: string }) => JSX.Element;
declare const Trash2: (props: { className?: string }) => JSX.Element;
declare const PlusCircle: (props: { className?: string }) => JSX.Element;
declare const cn: (...args: unknown[]) => string;

type RecipientDraft = { id: string; name: string; email: string; role: string };

type ConfigureRecipientsProps = {
  recipients: RecipientDraft[];
  onRecipientsChange: (recipients: RecipientDraft[]) => void;
  maxRecipients?: number;
  disabled?: boolean;
};

export function ConfigureDocumentRecipients({
  recipients,
  onRecipientsChange,
  maxRecipients = 10,
  disabled = false,
}: ConfigureRecipientsProps) {
  const addRecipient = () => {
    if (recipients.length >= maxRecipients) return;
    const newId = `r-${Date.now()}`;
    onRecipientsChange([...recipients, { id: newId, name: '', email: '', role: 'signer' }]);
  };

  const updateRecipient = (id: string, field: keyof RecipientDraft, value: string) => {
    onRecipientsChange(
      recipients.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
  };

  const removeRecipient = (id: string) => {
    onRecipientsChange(recipients.filter((r) => r.id !== id));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Recipients</h3>
        <Badge variant="outline">{recipients.length}/{maxRecipients}</Badge>
      </div>
      {recipients.length === 0 && (
        <p className="text-sm text-muted-foreground">No recipients added yet.</p>
      )}
      {recipients.map((recipient, index) => (
        <div key={recipient.id} className="rounded-md border p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Recipient {index + 1}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeRecipient(recipient.id)}
              disabled={disabled}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`name-${recipient.id}`}>Name</Label>
              <Input
                id={`name-${recipient.id}`}
                placeholder="Recipient name"
                value={recipient.name}
                onChange={(e) => updateRecipient(recipient.id, 'name', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`email-${recipient.id}`}>Email</Label>
              <Input
                id={`email-${recipient.id}`}
                type="email"
                placeholder="email@example.com"
                value={recipient.email}
                onChange={(e) => updateRecipient(recipient.id, 'email', e.target.value)}
              />
            </div>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={addRecipient}
        disabled={disabled || recipients.length >= maxRecipients}
        className="w-full"
      >
        <PlusCircle className="mr-2 h-4 w-4" />
        Add recipient
      </Button>
    </div>
  );
}
