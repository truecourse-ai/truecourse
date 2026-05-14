
// FP shape: component with destructured props and standard hook calls
declare function useNavigate(): (path: string) => void;
declare function useCurrentOrganisation(): { id: number; subscription: unknown };

type UploadButtonProps = {
  className?: string;
  folderId?: string;
};

export const UploadButton = ({ className, folderId }: UploadButtonProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const { user } = useSession();
  const navigate = useNavigate();
  const organisation = useCurrentOrganisation();

  return null;
};
