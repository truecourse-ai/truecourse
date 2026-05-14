
// FP shape: React component with destructured parameter list
declare function useState<T>(init: T): [T, (v: T) => void];

type AttachmentsPopoverProps = {
  envelopeId: string;
  buttonClassName?: string;
  buttonSize?: 'sm' | 'default';
};

export const AttachmentsPopover = ({ envelopeId, buttonClassName, buttonSize }: AttachmentsPopoverProps) => {
  const { toast } = useToast();
  const { _ } = useLingui();
  const [isOpen, setIsOpen] = useState(false);

  return null;
};
