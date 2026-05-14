
declare function convertHintsToManifestEntriesFb07: (hints: unknown[], resolver: (recipientHint: unknown, hint: unknown) => unknown, parcelId: string) => Array<{ recipientId: string; type: string; page: number; positionX: number; positionY: number; width: number; height: number; manifestMeta?: unknown }>;
declare function resolveRecipientByHintFb07: (recipientHint: unknown, hint: unknown, primary: unknown[], fallback: unknown[]) => unknown;
declare function injectFormValuesIntoLabelFb07: (opts: { label: Buffer; formValues: unknown }) => Promise<Buffer>;
declare function normalizeShippingLabelFb07: (buffer: Buffer, opts: { flattenForm: boolean }) => Promise<Buffer>;
declare function extractLabelHintsFb07: (label: Buffer) => Promise<{ cleanedLabel: Buffer; hints: unknown[] }>;
declare const SHIPMENT_AUDIT_LOG_TYPE_FB07: { PARCEL_CREATED: string };
declare const prefixedIdFb07: (kind: string) => string;
declare function storeLabelFileServerSideFb07: (opts: { name: string; type: string; arrayBuffer: () => Promise<Buffer> }) => Promise<{ labelData: { id: string } }>;
declare function buildShipmentAuditLogEntryFb07: (opts: { type: string; shipmentId: string; data: { parcelId: string; parcelTitle: string }; user: { name: string | null; email: string }; requestMetadata: unknown }) => unknown;
declare const shipmentDbFb07: {
  $transaction: <T>(fn: (tx: typeof shipmentDbFb07) => Promise<T>) => Promise<T>;
  parcel: {
    createManyAndReturn: (opts: { data: unknown[]; include?: object }) => Promise<Array<{ id: string; title: string; labelDataId: string; labelData: unknown }>>;
  };
  shipmentAuditLog: {
    createMany: (opts: { data: unknown[] }) => Promise<void>;
  };
  manifestEntry: {
    createMany: (opts: { data: unknown[] }) => Promise<void>;
  };
};
declare type RequestMetadataFb07 = { requestMetadata: unknown };
declare type ShipmentFb07 = {
  id: string;
  type: string;
  formValues: unknown;
  parcels: ParcelFb07[];
  recipients: ShipmentRecipientFb07[];
};
declare type ParcelFb07 = { id: string; order: number };
declare type ShipmentRecipientFb07 = { id: number; signingOrder: number | null };

type UnsafeCreateShipmentLinesOptionsFb07 = {
  files: {
    clientId?: string;
    file: File;
    orderOverride?: number;
  }[];
  shipment: ShipmentFb07 & {
    parcels: ParcelFb07[];
    recipients: ShipmentRecipientFb07[];
  };
  user: {
    id: number;
    name: string | null;
    email: string;
  };
  apiRequestMetadata: RequestMetadataFb07;
};

/**
 * Create parcel manifest entries for a shipment.
 *
 * It is assumed all prior validation has been completed.
 */
export const UNSAFE_createShipmentLinesFb07 = async ({
  files,
  shipment,
  user,
  apiRequestMetadata,
}: UnsafeCreateShipmentLinesOptionsFb07) => {
  const currentHighestOrderValue = shipment.parcels[shipment.parcels.length - 1]?.order ?? 1;

  // For each file: normalize, extract & clean hints, then upload.
  const parcelsToCreate = await Promise.all(
    files.map(async ({ file, orderOverride, clientId }, index) => {
      let buffer = Buffer.from(await file.arrayBuffer());

      if (shipment.formValues) {
        buffer = await injectFormValuesIntoLabelFb07({ label: buffer, formValues: shipment.formValues });
      }

      const normalized = await normalizeShippingLabelFb07(buffer, {
        flattenForm: shipment.type !== 'DRAFT',
      });

      const { cleanedLabel, hints } = await extractLabelHintsFb07(normalized);

      const { labelData } = await storeLabelFileServerSideFb07({
        name: file.name,
        type: 'application/pdf',
        arrayBuffer: async () => Promise.resolve(cleanedLabel),
      });

      return {
        id: prefixedIdFb07('parcel'),
        title: file.name,
        clientId,
        labelDataId: labelData.id,
        hints,
        order: orderOverride ?? currentHighestOrderValue + index + 1,
      };
    }),
  );

  return await shipmentDbFb07.$transaction(async (tx) => {
    const createdParcels = await tx.parcel.createManyAndReturn({
      data: parcelsToCreate.map((item) => ({
        id: item.id,
        shipmentId: shipment.id,
        title: item.title,
        labelDataId: item.labelDataId,
        order: item.order,
      })),
      include: {
        labelData: true,
      },
    });

    await tx.shipmentAuditLog.createMany({
      data: createdParcels.map((parcel) =>
        buildShipmentAuditLogEntryFb07({
          type: SHIPMENT_AUDIT_LOG_TYPE_FB07.PARCEL_CREATED,
          shipmentId: shipment.id,
          data: {
            parcelId: parcel.id,
            parcelTitle: parcel.title,
          },
          user: {
            name: user.name,
            email: user.email,
          },
          requestMetadata: apiRequestMetadata.requestMetadata,
        }),
      ),
    });

    // Create manifest entries from hints if the shipment already has recipients.
    if (shipment.recipients.length > 0) {
      const orderedRecipients = [...shipment.recipients].sort((a, b) => {
        const aOrder = a.signingOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.signingOrder ?? Number.MAX_SAFE_INTEGER;

        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }

        return a.id - b.id;
      });

      for (const uploadedParcel of parcelsToCreate) {
        if (!uploadedParcel.hints || uploadedParcel.hints.length === 0) {
          continue;
        }

        const createdParcel = createdParcels.find((cp) => cp.labelDataId === uploadedParcel.labelDataId);

        if (!createdParcel) {
          continue;
        }

        const entriesToCreate = convertHintsToManifestEntriesFb07(
          uploadedParcel.hints,
          (recipientHint, hint) =>
            resolveRecipientByHintFb07(recipientHint, hint, orderedRecipients, orderedRecipients),
          createdParcel.id,
        );

        if (entriesToCreate.length > 0) {
          await tx.manifestEntry.createMany({
            data: entriesToCreate.map((entry) => ({
              shipmentId: shipment.id,
              parcelId: createdParcel.id,
              recipientId: entry.recipientId,
              type: entry.type,
              page: entry.page,
              positionX: entry.positionX,
              positionY: entry.positionY,
              width: entry.width,
              height: entry.height,
              customText: '',
              inserted: false,
              manifestMeta: entry.manifestMeta || undefined,
            })),
          });
        }
      }
    }

    return createdParcels.map((parcel) => {
      const clientId = parcelsToCreate.find((file) => file.id === parcel.id)?.clientId;

      return {
        ...parcel,
        clientId,
      };
    });
  });
};
