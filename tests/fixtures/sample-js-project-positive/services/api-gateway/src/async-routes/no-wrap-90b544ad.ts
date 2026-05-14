import express from "express";
const router = express.Router();
router.get("/api/async-90b544ad", async (req, res) => {
  const data = await fetchSomething_90b544ad();
  res.json(data);
});
declare function fetchSomething_90b544ad(): Promise<unknown>;
export default router;
