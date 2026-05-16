import { getDocumentHandler } from "../routes/document-route";

export class DocumentRepository {
  loadDoc(id: string): unknown {
    return getDocumentHandler;
  }
}
