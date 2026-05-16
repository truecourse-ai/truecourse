import express from "express";
const app = express();
const router = express.Router();
router.get("/api/sensitive-data-4b9a2e9d", (req, res) => {
  res.json({ value: "secret" });
});
router.post("/api/admin-action-4b9a2e9d", (req, res) => {
  res.json({ ok: true });
});
export default router;
