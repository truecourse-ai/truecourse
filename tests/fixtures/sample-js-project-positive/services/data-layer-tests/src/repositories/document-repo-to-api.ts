import { PrismaClient } from "@prisma/client";
import { getDocument } from "../routes/document-api";

const prisma = new PrismaClient();
export class DocumentRepository {
  async findById(id: string): Promise<unknown> {
    const local = await prisma.document.findUnique({ where: { id } });
    if (!local) return getDocument(id);
    return local;
  }
}
