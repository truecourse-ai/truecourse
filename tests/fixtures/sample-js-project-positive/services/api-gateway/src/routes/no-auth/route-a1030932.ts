import express from "express";
const app = express();
const router = express.Router();
router.get("/api/sensitive-data-a1030932", (req, res) => {
  res.json({ value: "secret" });
});
router.post("/api/admin-action-a1030932", (req, res) => {
  res.json({ ok: true });
});
export default router;
