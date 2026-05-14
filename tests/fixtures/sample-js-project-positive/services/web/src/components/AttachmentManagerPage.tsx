import { useEffect, useMemo, useRef, useState } from 'react';

declare const useWorkspaceLimits: () => { maxAttachments: number; remainingUploads: number };
declare const useAttachmentBoard: () => {
  board: {
    id: string;
    attachments: ReadonlyArray<{ id: string; title: string; order: number; mimeType: string }>;
    recipients: ReadonlyArray<{ id: string; email: string }>;
  };
  saveBoard: (next: Record<string, unknown>) => void;
  goToStep: (step: string) => void;
  isEmbeddedMode: boolean;
};
declare const usePicker: (opts: Record<string, unknown>) => { openPicker: () => void; getPickerProps: () => Record<string, unknown> };
declare const useAutosave: <T>(handler: (value: T) => Promise<void>, delayMs: number) => { triggerSave: (value: T) => void; flush: () => Promise<void> };
declare function toast(opts: { title: string; description?: string; tone?: 'info' | 'destructive' }): void;
declare function randomToken(): string;
declare function megabytesToBytes(n: number): number;
declare function describeRejection(rejections: ReadonlyArray<{ code: string; message: string }>): string;

declare const Card: (p: { className?: string; children: JSX.Element | JSX.Element[] }) => JSX.Element;
declare const CardHeader: (p: { className?: string; children: JSX.Element | JSX.Element[] }) => JSX.Element;
declare const CardTitle: (p: { children: JSX.Element | string }) => JSX.Element;
declare const CardDescription: (p: { children: JSX.Element | string }) => JSX.Element;
declare const CardContent: (p: { children: JSX.Element | JSX.Element[] }) => JSX.Element;
declare const Button: (p: { type?: 'button'; variant?: 'ghost' | 'solid'; size?: 'sm' | 'md'; disabled?: boolean; onClick?: () => void; children: JSX.Element | string }) => JSX.Element;
declare const Dropzone: (p: { onDrop: (files: ReadonlyArray<File>) => void; onRejected: (r: ReadonlyArray<{ code: string; message: string }>) => void; disabled: boolean; disabledMessage?: string; maxFiles: number; className?: string }) => JSX.Element;
declare const AttachmentTitleField: (p: { value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) => JSX.Element;
declare const AttachmentDeleteDialog: (p: { attachmentId: string; title: string; onConfirm: (id: string) => void; trigger: JSX.Element }) => JSX.Element;
declare const ReorderContainer: (p: { onReorder: (from: number, to: number) => void; children: JSX.Element | JSX.Element[] }) => JSX.Element;
declare const ReorderItem: (p: { id: string; index: number; disabled: boolean; children: JSX.Element }) => JSX.Element;
declare const SpinnerIcon: (p: { className?: string }) => JSX.Element;
declare const WarningIcon: (p: { className?: string }) => JSX.Element;
declare const PencilIcon: (p: { className?: string }) => JSX.Element;
declare const TrashIcon: (p: { className?: string }) => JSX.Element;
declare const GripIcon: (p: { className?: string }) => JSX.Element;

type StagedAttachment = {
  id: string;
  title: string;
  attachmentId: string | null;
  isUploading: boolean;
  isReplacing: boolean;
  isErrored: boolean;
};

export const AttachmentManagerPage = (): JSX.Element => {
  const { maxAttachments, remainingUploads } = useWorkspaceLimits();
  const { board, saveBoard, goToStep, isEmbeddedMode } = useAttachmentBoard();

  const [staged, setStaged] = useState<StagedAttachment[]>(
    board.attachments
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        id: item.id,
        title: item.title,
        attachmentId: item.id,
        isUploading: false,
        isReplacing: false,
        isErrored: false,
      })),
  );

  const replacingIdRef = useRef<string | null>(null);

  const { openPicker: openReplacePicker, getPickerProps: getReplacePickerProps } = usePicker({
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: megabytesToBytes(25),
    multiple: false,
    onDrop: (incoming: ReadonlyArray<File>) => {
      const file = incoming[0];
      const replacingId = replacingIdRef.current;
      if (file && replacingId) {
        void onReplacePdf(replacingId, file);
        replacingIdRef.current = null;
      }
    },
    onRejected: (rejections: ReadonlyArray<{ code: string; message: string }>) => onFileRejected(rejections),
    onCancel: () => {
      replacingIdRef.current = null;
    },
  });

  const boardCapabilities = useMemo(
    () => ({
      canChangeFile: !isEmbeddedMode || board.recipients.length === 0,
      canChangeTitle: !isEmbeddedMode,
      canChangeOrder: board.attachments.length > 1,
    }),
    [isEmbeddedMode, board.recipients.length, board.attachments.length],
  );

  const onFileDrop = async (files: ReadonlyArray<File>): Promise<void> => {
    const queued: StagedAttachment[] = files.map((file) => ({
      id: randomToken(),
      title: file.name,
      attachmentId: isEmbeddedMode ? `embed_${randomToken()}` : null,
      isUploading: !isEmbeddedMode,
      isReplacing: false,
      isErrored: false,
    }));

    setStaged((prev) => [...prev, ...queued]);

    if (isEmbeddedMode) {
      saveBoard({
        attachments: [
          ...board.attachments,
          ...queued.map((q, idx) => ({
            id: q.attachmentId!,
            title: q.title,
            order: board.attachments.length + idx + 1,
            mimeType: 'application/pdf',
          })),
        ],
      });
      return;
    }

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      setStaged((prev) =>
        prev.map((p) =>
          queued.find((q) => q.id === p.id)
            ? { ...p, isUploading: false, attachmentId: p.id }
            : p,
        ),
      );
    } catch (err) {
      console.error(err);
      setStaged((prev) =>
        prev.map((p) => (queued.find((q) => q.id === p.id) ? { ...p, isErrored: true, isUploading: false } : p)),
      );
    }
  };

  const onReplacePdf = async (attachmentId: string, file: File): Promise<void> => {
    setStaged((prev) => prev.map((s) => (s.attachmentId === attachmentId ? { ...s, isReplacing: true } : s)));
    try {
      await file.arrayBuffer();
      saveBoard({
        attachments: board.attachments.map((a) => (a.id === attachmentId ? { ...a, mimeType: 'application/pdf' } : a)),
      });
    } catch (err) {
      console.error(err);
      toast({ title: 'Replace failed', description: 'Something went wrong while replacing the PDF', tone: 'destructive' });
    } finally {
      setStaged((prev) => prev.map((s) => (s.attachmentId === attachmentId ? { ...s, isReplacing: false } : s)));
    }
  };

  const onAttachmentDelete = (attachmentId: string): void => {
    setStaged((prev) => prev.filter((s) => s.attachmentId !== attachmentId));
    saveBoard({ attachments: board.attachments.filter((a) => a.id !== attachmentId) });
  };

  const onReorder = (from: number, to: number): void => {
    const next = staged.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setStaged(next);
    triggerOrderSave(next);
  };

  const { triggerSave: triggerOrderSave, flush: flushOrderSave } = useAutosave(
    async (list: StagedAttachment[]) => {
      saveBoard({
        attachments: list
          .filter((s) => s.attachmentId)
          .map((s, idx) => ({ id: s.attachmentId!, title: s.title, order: idx + 1, mimeType: 'application/pdf' })),
      });
    },
    isEmbeddedMode ? 0 : 1000,
  );

  const flushRef = useRef(flushOrderSave);
  flushRef.current = flushOrderSave;

  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, []);

  const onTitleChange = (attachmentId: string, title: string): void => {
    const next = staged.map((s) => (s.attachmentId === attachmentId ? { ...s, title } : s));
    setStaged(next);
    triggerOrderSave(next);
  };

  const dropzoneDisabledMessage = useMemo(() => {
    if (!boardCapabilities.canChangeFile) return 'Cannot add attachments after the board has been sent';
    if (remainingUploads === 0) return 'Uploads disabled due to plan limits';
    if (maxAttachments <= staged.length) return `You cannot upload more than ${maxAttachments} attachments per board.`;
    return null;
  }, [staged.length, maxAttachments, remainingUploads, boardCapabilities.canChangeFile]);

  const onFileRejected = (rejections: ReadonlyArray<{ code: string; message: string }>): void => {
    const tooMany = rejections.some((r) => r.code === 'too-many-files');
    if (tooMany) {
      toast({ title: `You cannot upload more than ${maxAttachments} attachments per board.`, tone: 'destructive' });
      return;
    }
    toast({ title: 'Upload failed', description: describeRejection(rejections), tone: 'destructive' });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <input {...getReplacePickerProps()} />
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle>Attachments</CardTitle>
          <CardDescription>Add and configure multiple attachments</CardDescription>
        </CardHeader>
        <CardContent>
          <Dropzone
            onDrop={onFileDrop}
            onRejected={onFileRejected}
            disabled={dropzoneDisabledMessage !== null}
            disabledMessage={dropzoneDisabledMessage || undefined}
            maxFiles={maxAttachments - staged.length}
            className="pt-6 pb-4"
          />
          <div className="mt-4">
            <ReorderContainer onReorder={onReorder}>
              {staged.map((item, index) => (
                <ReorderItem
                  key={item.id}
                  id={item.id}
                  index={index}
                  disabled={!boardCapabilities.canChangeOrder || item.isReplacing}
                >
                  <div className="flex items-center justify-between rounded-lg bg-accent/50 p-3">
                    <div className="flex min-w-0 items-center space-x-3">
                      {boardCapabilities.canChangeOrder && (
                        <div className="cursor-grab">
                          <GripIcon className="h-5 w-5 opacity-40" />
                        </div>
                      )}
                      <div className="min-w-0">
                        {item.attachmentId !== null ? (
                          <AttachmentTitleField
                            value={item.title}
                            disabled={!boardCapabilities.canChangeTitle || item.isReplacing}
                            placeholder="Attachment title"
                            onChange={(next) => onTitleChange(item.attachmentId!, next)}
                          />
                        ) : (
                          <p className="text-sm font-medium">{item.title}</p>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {item.isUploading ? 'Uploading' : item.isErrored ? 'Failed to upload' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center space-x-2">
                      {item.isUploading && (
                        <div className="flex h-6 w-10 items-center justify-center">
                          <SpinnerIcon className="h-4 w-4 animate-spin" />
                        </div>
                      )}
                      {item.isErrored && (
                        <div className="flex h-6 w-10 items-center justify-center">
                          <WarningIcon className="h-4 w-4 text-destructive" />
                        </div>
                      )}
                      {item.attachmentId && boardCapabilities.canChangeFile && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={item.isReplacing || item.isUploading}
                          onClick={() => {
                            replacingIdRef.current = item.attachmentId;
                            openReplacePicker();
                          }}
                        >
                          {item.isReplacing ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <PencilIcon className="h-4 w-4" />}
                        </Button>
                      )}
                      {item.attachmentId && (
                        <AttachmentDeleteDialog
                          attachmentId={item.attachmentId}
                          title={item.title}
                          onConfirm={onAttachmentDelete}
                          trigger={
                            <Button variant="ghost" size="sm" disabled={item.isReplacing || item.isUploading}>
                              <TrashIcon className="h-4 w-4" />
                            </Button>
                          }
                        />
                      )}
                    </div>
                  </div>
                </ReorderItem>
              ))}
            </ReorderContainer>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="button" onClick={() => goToStep('addFields')}>Add Fields</Button>
      </div>
    </div>
  );
};
