
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useForm(opts: any): any;
declare const zodResolver: (schema: any) => any;
declare const z: any;
declare const trpc: any;

type DomainRecord = { name: string; value: string; type: string };

export function TeamEmailDomainCreateDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'domain' | 'verification'>('domain');
  const [dnsRecords, setDnsRecords] = useState<DomainRecord[]>([]);

  const form = useForm({
    resolver: zodResolver(z.object({ domain: z.string().min(1) })),
    defaultValues: { domain: '' },
  });

  const onSubmit = async ({ domain }: { domain: string }) => {
    // submit and advance to verification step
    setStep('verification');
  };

  return null;
}
