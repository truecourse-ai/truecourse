import type { TInviteRecord } from '@myapp/lib/types/invite';
import { buildDefaultInvitePayload } from '@myapp/lib/utils/invite-helpers';
import { trpc } from '@myapp/trpc/react';
import type { ZCreateInviteRequestSchema } from '@myapp/trpc/server/admin-router/create-invite.types';
import { Button } from '@myapp/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@myapp/ui/primitives/dialog';
import { useToast } from '@myapp/ui/primitives/use-toast';
import { useState } from 'react';
import type { z } from 'zod';

import { InviteForm } from './InviteForm';

declare const React: { createElement: Function; Fragment: unknown };
declare function useState<T>(init: T): [T, (v: T) => void];
declare const trpc: {
  admin: {
    invites: {
      create: {
        useMutation(opts: {
          onSuccess?: () => void;
          onError?: (e: Error) => void;
        }): { mutateAsync: (data: unknown) => Promise<void>; isPending: boolean };
      };
    };
  };
};
declare function buildDefaultInvitePayload(record?: TInviteRecord): Record<string, unknown>;
declare const Button: (props: Record<string, unknown>) => JSX.Element;
declare const Dialog: (props: Record<string, unknown>) => JSX.Element;
declare const DialogContent: (props: Record<string, unknown>) => JSX.Element;
declare const DialogDescription: (props: Record<string, unknown>) => JSX.Element;
declare const DialogFooter: (props: Record<string, unknown>) => JSX.Element;
declare const DialogHeader: (props: Record<string, unknown>) => JSX.Element;
declare const DialogTitle: (props: Record<string, unknown>) => JSX.Element;
declare const DialogTrigger: (props: Record<string, unknown>) => JSX.Element;
declare function useToast(): { toast: (opts: { title: string }) => void };
declare const InviteForm: (props: Record<string, unknown>) => JSX.Element;

export type CreateInviteFormValues = z.infer<typeof ZCreateInviteRequestSchema>;

type InviteDialogProps = {
  inviteFlags?: TInviteRecord;
};

export const InviteDialog = ({ inviteFlags }: InviteDialogProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const defaultValues = buildDefaultInvitePayload(inviteFlags);

  const { mutateAsync: createInvite, isPending } = trpc.admin.invites.create.useMutation({
    onSuccess: () => {
      toast({
        title: 'Invite created successfully.',
      });
      setOpen(false);
    },
    onError: (err) => {
      toast({
        title: err.message ?? 'Failed to create invite.',
      });
    },
  });

  const handleSubmit = async (values: CreateInviteFormValues) => {
    await createInvite(values);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Create Invite</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new invite</DialogTitle>
          <DialogDescription>
            Configure the invite before sending it out.
          </DialogDescription>
        </DialogHeader>
        <InviteForm defaultValues={defaultValues} onSubmit={handleSubmit} />
        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Creating...' : 'Create Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
