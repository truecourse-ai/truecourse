import express from "express";
const router = express.Router();
export function getDocumentHandler(req: express.Request, res: express.Response): void {
  res.json({ ok: true });
}
router.get("/api/documents", getDocumentHandler);
export default router;
