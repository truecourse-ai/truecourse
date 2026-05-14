import express from "express";
const router = express.Router();
router.get("/api/async-80427835", async (req, res) => {
  const data = await fetchSomething_80427835();
  res.json(data);
});
declare function fetchSomething_80427835(): Promise<unknown>;
export default router;
