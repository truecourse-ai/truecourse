import express from "express";
const router = express.Router();
router.get("/api/async-2dfbb9ad", async (req, res) => {
  const data = await fetchSomething_2dfbb9ad();
  res.json(data);
});
declare function fetchSomething_2dfbb9ad(): Promise<unknown>;
export default router;
