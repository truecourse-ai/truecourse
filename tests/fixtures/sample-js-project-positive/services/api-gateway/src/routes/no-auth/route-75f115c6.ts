import express from "express";
const app = express();
const router = express.Router();
router.get("/api/sensitive-data-75f115c6", (req, res) => {
  res.json({ value: "secret" });
});
router.post("/api/admin-action-75f115c6", (req, res) => {
  res.json({ ok: true });
});
export default router;
