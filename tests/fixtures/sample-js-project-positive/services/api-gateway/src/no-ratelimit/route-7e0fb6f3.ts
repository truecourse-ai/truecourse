import express from "express";
declare const authMiddleware: express.RequestHandler;
const router = express.Router();
router.post("/api/expensive-7e0fb6f3", authMiddleware, async (req, res) => {
  res.json({ ok: true });
});
export default router;
