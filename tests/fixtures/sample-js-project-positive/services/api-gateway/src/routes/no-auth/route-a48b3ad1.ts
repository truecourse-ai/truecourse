import express from "express";
const app = express();
const router = express.Router();
router.get("/api/sensitive-data-a48b3ad1", (req, res) => {
  res.json({ value: "secret" });
});
router.post("/api/admin-action-a48b3ad1", (req, res) => {
  res.json({ ok: true });
});
export default router;
