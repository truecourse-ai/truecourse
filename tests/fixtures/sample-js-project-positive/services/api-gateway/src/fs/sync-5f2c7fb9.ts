import express from "express";
import * as fs from "fs";
const router = express.Router();
router.get("/api/file-5f2c7fb9", (req, res) => {
  const content = fs.readFileSync("/tmp/data.txt", "utf-8");
  res.send(content);
});
export default router;
