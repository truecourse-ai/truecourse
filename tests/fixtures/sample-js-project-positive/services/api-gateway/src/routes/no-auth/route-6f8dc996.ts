import express from "express";
const app = express();
const router = express.Router();
router.get("/api/sensitive-data-6f8dc996", (req, res) => {
  res.json({ value: "secret" });
});
router.post("/api/admin-action-6f8dc996", (req, res) => {
  res.json({ ok: true });
});
export default router;
