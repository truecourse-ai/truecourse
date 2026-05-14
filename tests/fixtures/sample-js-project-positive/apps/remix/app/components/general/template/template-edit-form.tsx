declare const useForm: (opts: unknown) => { register: (name: string, opts?: unknown) => unknown; handleSubmit: (fn: (data: unknown) => void) => (e: React.FormEvent) => void; formState: { errors: Record<string, { message?: string }>; isSubmitting: boolean; isDirty: boolean } };
declare const Button: (props: { children: React.ReactNode; type?: string; disabled?: boolean; variant?: string }) => JSX.Element;
declare const Input: (props: { id?: string; placeholder?: string; disabled?: boolean } & Record<string, unknown>) => JSX.Element;
declare const Textarea: (props: { id?: string; placeholder?: string; rows?: number; disabled?: boolean } & Record<string, unknown>) => JSX.Element;
declare const Label: (props: { htmlFor?: string; children: React.ReactNode }) => JSX.Element;
declare const Switch: (props: { id?: string; checked?: boolean; onCheckedChange?: (v: boolean) => void; disabled?: boolean }) => JSX.Element;
declare const useToast: () => { toast: (opts: { title: string; variant?: string }) => void };
declare const updateTemplate: (id: string, data: unknown) => Promise<void>;

type TemplateEditFormProps = {
  templateId: string;
  initialValues: {
    name: string;
    description?: string;
    isPublic: boolean;
    sendingAllowed: boolean;
  };
  onSaved?: () => void;
};

export function TemplateEditForm({ templateId, initialValues, onSaved }: TemplateEditFormProps) {
  const { toast } = useToast();
  const [isPublic, setIsPublic] = React.useState(initialValues.isPublic);
  const [sendingAllowed, setSendingAllowed] = React.useState(initialValues.sendingAllowed);
  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm({
    defaultValues: initialValues,
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await updateTemplate(templateId, { ...data, isPublic, sendingAllowed });
      toast({ title: 'Template saved' });
      onSaved?.();
    } catch {
      toast({ title: 'Failed to save template', variant: 'destructive' });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tmpl-name">Template name</Label>
        <Input
          id="tmpl-name"
          placeholder="e.g. NDA Agreement"
          disabled={isSubmitting}
          {...register('name', { required: 'Name is required' })}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tmpl-description">Description</Label>
        <Textarea
          id="tmpl-description"
          placeholder="Optional description"
          rows={3}
          disabled={isSubmitting}
          {...register('description')}
        />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="tmpl-public" className="font-medium">Public template</Label>
          <p className="text-xs text-muted-foreground">Allow anyone with the link to use this template.</p>
        </div>
        <Switch id="tmpl-public" checked={isPublic} onCheckedChange={setIsPublic} disabled={isSubmitting} />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="tmpl-sending" className="font-medium">Allow direct sending</Label>
          <p className="text-xs text-muted-foreground">Recipients can be notified immediately upon form submission.</p>
        </div>
        <Switch id="tmpl-sending" checked={sendingAllowed} onCheckedChange={setSendingAllowed} disabled={isSubmitting} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}



// catch(err) passes err to console.error and shows generic toast — no property access — FP shape 018f8ae9d2a2
declare function showToast(opts: { title: string; description: string; variant?: string }): void;
declare function navigateTo(path: string): Promise<void>;
declare function saveTemplateFields(data: any): Promise<void>;

async function handleSaveTemplate(formData: any) {
  try {
    await saveTemplateFields(formData);

    showToast({
      title: 'Template saved',
      description: 'Your template has been saved successfully.',
    });

    await navigateTo('/templates');
  } catch (err) {
    console.error(err);

    showToast({
      title: 'Error',
      description: 'An error occurred while saving the template.',
      variant: 'destructive',
    });
  }
}



// catch(err) passes err directly to console.error — no property access — FP shape 0305a1104ef0
declare function bulkSendTemplates(opts: any): Promise<void>;

async function handleBulkSend(values: any, onSuccess?: () => void) {
  try {
    await bulkSendTemplates({
      templateId: values.templateId,
      csvData: values.csvData,
      sendImmediately: values.sendImmediately,
    });

    showToast({
      title: 'Success',
      description: 'Your bulk send has been initiated.',
    });

    onSuccess?.();
  } catch (err) {
    console.error(err);

    showToast({
      title: 'Error',
      description: 'Failed to upload CSV. Please check the file format and try again.',
      variant: 'destructive',
    });
  }
}



// AppError.parseError(err) normalizes the caught value — FP shape 04213d696758
declare const AppError: { parseError: (e: unknown) => { code: string; message: string } };
declare function registerUser(opts: { email: string; password: string }): Promise<void>;
declare const SIGNUP_ERROR_MESSAGES: Record<string, string>;

async function handleSignup(email: string, password: string) {
  try {
    await registerUser({ email, password });

    showToast({
      title: 'Registered',
      description: 'Please verify your email to continue.',
    });
  } catch (err) {
    const error = AppError.parseError(err);

    const errorMessage = SIGNUP_ERROR_MESSAGES[error.code] ?? SIGNUP_ERROR_MESSAGES['INVALID_REQUEST'];

    showToast({
      title: 'An error occurred',
      description: errorMessage,
      variant: 'destructive',
    });
  }
}



// AppError.parseError(err) with match() pattern dispatch — FP shape 098233b8be75
declare function moveFolderItems(opts: any): Promise<void>;
declare function match<T>(val: T): any;
declare const AppErrorCode: Record<string, string>;

async function handleBulkMoveItems(
  items: any[],
  targetFolderId: string,
  onSuccess?: () => void,
  onOpenChange?: (open: boolean) => void,
) {
  try {
    await moveFolderItems({ items, targetFolderId });

    showToast({ description: 'Selected items have been moved.' });

    onSuccess?.();
    onOpenChange?.(false);
  } catch (err) {
    const error = AppError.parseError(err);

    const errorMessage = match(error.code)
      .with(AppErrorCode.NOT_FOUND, () => 'The folder does not exist.')
      .with(AppErrorCode.UNAUTHORIZED, () => 'You are not allowed to move these items.')
      .otherwise(() => 'An error occurred while moving the items.');

    showToast({ description: errorMessage, variant: 'destructive' });
  }
}



// console.error('label:', error) — error passed as argument, no property access — FP shape 0a0a85b6f335
declare const localStorage: Storage;

function handleSaveFieldSettings(fieldState: any, localStorageKey: string, onSave?: (state: any) => void) {
  try {
    localStorage.setItem(localStorageKey, JSON.stringify(fieldState));
    onSave?.(fieldState);
  } catch (error) {
    console.error('Failed to save to localStorage:', error);

    showToast({
      title: 'Error',
      description: 'Failed to save settings.',
      variant: 'destructive',
    });
  }
}



// catch(error): setState + console.error(error) — no MemberExpression on error — FP shape 0b498cf63f31
declare function useState<T>(init: T): [T, (v: T) => void];
declare function downloadPDF(opts: any): Promise<void>;

function useDownloadState() {
  const [isDownloadingState, setIsDownloadingState] = useState<Record<string, boolean>>({});

  async function handleDownload(itemId: string, version: string) {
    try {
      await downloadPDF({ itemId, version });

      setIsDownloadingState((prev: Record<string, boolean>) => ({
        ...prev,
        [`${itemId}:${version}`]: false,
      }));
    } catch (error) {
      setIsDownloadingState((prev: Record<string, boolean>) => ({
        ...prev,
        [`${itemId}:${version}`]: false,
      }));

      console.error(error);

      showToast({
        title: 'Something went wrong',
        description: 'This document could not be downloaded.',
        variant: 'destructive',
      });
    }
  }

  return { isDownloadingState, handleDownload };
}



// AppError.parseError(err) with conditional code check — FP shape 0ca39072cdbf
declare function deleteFolder(opts: { folderId: string }): Promise<void>;

async function handleDeleteFolder(
  folderId: string,
  onOpenChange: (open: boolean) => void,
) {
  try {
    await deleteFolder({ folderId });

    onOpenChange(false);

    showToast({ title: 'Folder deleted successfully' });
  } catch (err) {
    const error = AppError.parseError(err);

    if (error.code === AppErrorCode.NOT_FOUND) {
      showToast({
        title: 'Folder not found',
        description: 'The folder you are trying to delete does not exist.',
        variant: 'destructive',
      });
      return;
    }

    showToast({
      title: 'Error',
      description: 'An error occurred while deleting the folder.',
      variant: 'destructive',
    });
  }
}



// AppError.parseError(err) with switch on error.code — FP shape 0fd56fa270f5
declare function updatePublicProfile(opts: any): Promise<void>;
declare const form2: any;

async function handleProfileUpdate(data: any) {
  try {
    await updatePublicProfile(data);

    showToast({
      title: 'Success',
      description: 'Your public profile has been updated.',
    });

    form2.reset({ url: data.url, bio: data.bio });
  } catch (err) {
    const error = AppError.parseError(err);

    switch (error.code) {
      case AppErrorCode.ALREADY_EXISTS:
      case 'PROFILE_URL_TAKEN':
        form2.setError('url', { type: 'manual', message: error.message });
        break;
      default:
        showToast({
          title: 'Error',
          description: 'An error occurred while updating your profile.',
          variant: 'destructive',
        });
    }
  }
}



// catch(error): console.error(error) — error passed directly, no property access — FP shape 1081ba55e2fa
declare function revokeAllSessions(): Promise<void>;
declare function setState(fn: (prev: boolean) => boolean): void;

async function handleRevokeAllSessions(onSuccess?: () => Promise<void>) {
  try {
    await revokeAllSessions();

    if (onSuccess) {
      await onSuccess();
    }

    showToast({ title: 'Sessions have been revoked' });
  } catch (error) {
    console.error(error);

    showToast({
      title: 'Error',
      description: 'Failed to revoke all sessions',
      variant: 'destructive',
    });
  }
}
