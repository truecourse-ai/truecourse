
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useNavigate: () => (path: string) => void;
declare const useLoaderData: <T>() => T;
declare const Form: any;
declare const json: (data: any, opts?: any) => any;
declare const redirect: (path: string) => any;
declare const requireUser: (req: any) => Promise<any>;
declare const createTemplate: (input: any) => Promise<any>;
declare const z: any;
declare const Button: any;
declare const Input: any;
declare const Label: any;
declare const Textarea: any;
declare const Select: any;
declare const SelectContent: any;
declare const SelectItem: any;
declare const SelectTrigger: any;
declare const SelectValue: any;

const ZCreateTemplateSchema = z.object({
  title: z.string().min(1).max(150),
  description: z.string().max(500).optional(),
  visibility: z.enum(['EVERYONE', 'ADMIN', 'MANAGER']),
});

export function TemplateCreatePage() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const handleCancel = () => {
    navigate('/templates');
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Create Template</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a reusable document template for your team.
        </p>
      </div>

      <Form method="post" className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            name="title"
            placeholder="e.g. NDA Agreement"
            required
            maxLength={150}
          />
          {titleError && (
            <p className="text-sm text-destructive">{titleError}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            placeholder="Optional description"
            rows={3}
            maxLength={500}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="visibility">Visibility</Label>
          <Select name="visibility" defaultValue="EVERYONE">
            <SelectTrigger id="visibility">
              <SelectValue placeholder="Select visibility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EVERYONE">Everyone</SelectItem>
              <SelectItem value="MANAGER">Managers only</SelectItem>
              <SelectItem value="ADMIN">Admins only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create Template'}
          </Button>
        </div>
      </Form>
    </div>
  );
}
