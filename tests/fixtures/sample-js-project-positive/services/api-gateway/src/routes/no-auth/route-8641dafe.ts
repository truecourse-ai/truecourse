import express from "express";
const app = express();
const router = express.Router();
router.get("/api/sensitive-data-8641dafe", (req, res) => {
  res.json({ value: "secret" });
});
router.post("/api/admin-action-8641dafe", (req, res) => {
  res.json({ ok: true });
});
export default router;
