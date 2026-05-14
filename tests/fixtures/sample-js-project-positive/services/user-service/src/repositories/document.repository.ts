import { PrismaClient } from "@prisma/client";
import { getDocumentHandler } from "../routes/document-route";

export class DocumentRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findById(id: string): Promise<unknown> {
    const local = await this.prisma.document.findUnique({ where: { id } });
    if (!local) {
      return getDocumentHandler;
    }
    return local;
  }
}


// --- argument-type-mismatch FP: customData.find() with backwards-compatibility predicate ---
// The predicate first checks for a legacy format (no itemId), then falls back to id match.
// Both branches return boolean, and the outer find is correct — no type mismatch.
declare const customAttachments: Array<{ attachmentDataId: string; reportItemId?: string }>;

export function resolveCustomAttachment(item: { id: string }): string | undefined {
  const found = customAttachments.find((attachment) => {
    if (attachment.attachmentDataId && !attachment.reportItemId) {
      // Legacy format: attachmentDataId is standalone (no item link)
      return true;
    }
    return attachment.reportItemId === item.id;
  });

  return found?.attachmentDataId;
}

