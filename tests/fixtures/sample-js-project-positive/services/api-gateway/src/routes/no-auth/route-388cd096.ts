import express from "express";
const app = express();
const router = express.Router();
router.get("/api/sensitive-data-388cd096", (req, res) => {
  res.json({ value: "secret" });
});
router.post("/api/admin-action-388cd096", (req, res) => {
  res.json({ ok: true });
});
export default router;
