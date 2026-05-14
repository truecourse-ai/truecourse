import express from "express";
const router = express.Router();
router.get("/api/data-21b72775", async (req, res) => {
  try {
    throw new Error("internal-error");
  } catch (err) {
    res.status(500).json({ error: (err as Error).message, stack: (err as Error).stack });
  }
});
export default router;
