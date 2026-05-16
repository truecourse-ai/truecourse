import express from "express";
const router = express.Router();
export function getDocument(id: string): Promise<unknown> {
  return Promise.resolve({ id });
}
router.get("/api/documents/:id", (req, res) => {
  res.json({ id: req.params.id });
});
export default router;
