import express from "express";
import * as fs from "fs";
const router = express.Router();
router.get("/api/file-236762de", (req, res) => {
  const content = fs.readFileSync("/tmp/data.txt", "utf-8");
  res.send(content);
});
export default router;
