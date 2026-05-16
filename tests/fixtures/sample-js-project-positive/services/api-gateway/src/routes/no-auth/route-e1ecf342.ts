import express from "express";
const app = express();
const router = express.Router();
router.get("/api/sensitive-data-e1ecf342", (req, res) => {
  res.json({ value: "secret" });
});
router.post("/api/admin-action-e1ecf342", (req, res) => {
  res.json({ ok: true });
});
export default router;
