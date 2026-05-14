import express from "express";
const router = express.Router();
router.get("/api/async-3552a2f6", async (req, res) => {
  const data = await fetchSomething_3552a2f6();
  res.json(data);
});
declare function fetchSomething_3552a2f6(): Promise<unknown>;
export default router;
