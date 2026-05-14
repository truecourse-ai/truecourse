// import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
// import { useDebouncedValue } from '@documenso/lib/client-only/hooks/use-debounced-value';
// import { ZEditorRecipientsFormSchema } from '@documenso/lib/client-only/hooks/use-editor-recipients';
// import { useCurrentEnvelopeEditor } from '@documenso/lib/client-only/providers/envelope-editor-provider';
// import { useCurrentOrganisation } from '@documenso/lib/client-only/providers/organisation';
// import { useOptionalSession } from '@documenso/lib/client-only/providers/session';
// import type { TDetectedRecipientSchema } from '@documenso/lib/server-only/ai/envelope/detect-recipients/schema';
// import { ZRecipientAuthOptionsSchema } from '@documenso/lib/types/document-auth';
// import { nanoid } from '@documenso/lib/universal/id';
// import { canRecipientBeModified as utilCanRecipientBeModified } from '@documenso/lib/utils/recipients';
// import { trpc } from '@documenso/trpc/react';
// import { RecipientActionAuthSelect } from '@documenso/ui/components/recipient/recipient-action-auth-select';
import {
// import { RecipientRoleSelect } from '@documenso/ui/components/recipient/recipient-role-select';
// import { cn } from '@documenso/ui/lib/utils';
// import { Button } from '@documenso/ui/primitives/button';
// import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@documenso/ui/primitives/card';
// import { Checkbox } from '@documenso/ui/primitives/checkbox';
// import { SigningOrderConfirmation } from '@documenso/ui/primitives/document-flow/signing-order-confirmation';
// import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@documenso/ui/primitives/form/form';
// import { FormErrorMessage } from '@documenso/ui/primitives/form/form-error-message';
// import { Input } from '@documenso/ui/primitives/input';
// import { Tooltip, TooltipContent, TooltipTrigger } from '@documenso/ui/primitives/tooltip';
// import { useToast } from '@documenso/ui/primitives/use-toast';
// import { DragDropContext, Draggable, Droppable, type DropResult, type SensorAPI } from '@hello-pangea/dnd';
// import { plural } from '@lingui/core/macro';
// import { Trans, useLingui } from '@lingui/react/macro';
// import { DocumentSigningOrder, EnvelopeType, RecipientRole, SendStatus } from '@prisma/client';
// import { motion } from 'framer-motion';
// import { GripVerticalIcon, HelpCircleIcon, PlusIcon, SparklesIcon, TrashIcon } from 'lucide-react';
// import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// import { useFieldArray, useWatch } from 'react-hook-form';
// import { useRevalidator, useSearchParams } from 'react-router';
// import { isDeepEqual } from 'remeda';
// import { AiFeaturesEnableDialog } from '~/components/dialogs/ai-features-enable-dialog';
// import { AiRecipientDetectionDialog } from '~/components/dialogs/ai-recipient-detection-dialog';
// import { useCurrentTeam } from '~/providers/team';

// ── snippet ──

      form.setFocus(`signers.${emptySignerIndex}.email`);
    } else {
      appendSigner(
        {
          formId: nanoid(12),
          name: currentEditorName ?? '',
          email: currentEditorEmail ?? '',
          role: RecipientRole.SIGNER,
          actionAuth: [],
          signingOrder: signers.length > 0 ? (signers[signers.length - 1]?.signingOrder ?? 0) + 1 : 1,
        },
        {
          shouldFocus: true,
        },
      );

      void form.trigger('signers');
    }
  };

  const handleRecipientAutoCompleteSelect = (index: number, suggestion: RecipientAutoCompleteOption) => {
    setValue(`signers.${index}.email`, suggestion.email, {
      shouldValidate: true,
      shouldDirty: true,
    });
    setValue(`signers.${index}.name`, suggestion.name || '', {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const onDragEnd = useCallback(
    async (result: DropResult) => {
      if (!result.destination) {
        return;
      }

      const items = Array.from(watchedSigners);
      const [reorderedSigner] = items.splice(result.source.index, 1);

      // Find next valid position
      let insertIndex = result.destination.index;
      while (insertIndex < items.length && !canRecipientBeModified(items[insertIndex].id)) {
        insertIndex++;
      }

      items.splice(insertIndex, 0, reorderedSigner);

      const updatedSigners = items.map((signer, index) => ({
        ...signer,
        signingOrder: !canRecipientBeModified(signer.id) ? signer.signingOrder : index + 1,
      }));

      form.setValue('signers', updatedSigners, {
        shouldValidate: true,
        shouldDirty: true,
      });

      const lastSigner = updatedSigners[updatedSigners.length - 1];
      if (lastSigner.role === RecipientRole.ASSISTANT) {
        toast({
          title: t`Warning: Assistant as last signer`,
          description: t`Having an assistant as the last signer means they will be unable to take any action as there are no subsequent signers to assist.`,
        });
      }

      await form.trigger('signers');
    },
    [form, canRecipientBeModified, watchedSigners, toast],
  );

  const handleRoleChange = useCallback(
    (index: number, role: RecipientRole) => {
      const currentSigners = form.getValues('signers');
      const signingOrder = form.getValues('signingOrder');

      // Handle parallel to sequential conversion for assistants
      if (role === RecipientRole.ASSISTANT && signingOrder === DocumentSigningOrder.PARALLEL) {
        form.setValue('signingOrder', DocumentSigningOrder.SEQUENTIAL, {
          shouldValidate: true,
          shouldDirty: true,
        });
        toast({
          title: t`Signing order is enabled.`,
          description: t`You cannot add assistants when signing order is disabled.`,
          variant: 'destructive',
        });
        return;
      }

      const updatedSigners = currentSigners.map((signer, idx) => ({
        ...signer,
        role: idx === index ? role : signer.role,
        signingOrder: !canRecipientBeModified(signer.id) ? signer.signingOrder : idx + 1,
      }));

      form.setValue('signers', updatedSigners, {
        shouldValidate: true,
        shouldDirty: true,