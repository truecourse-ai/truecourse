import express from 'express';

const router = express.Router();

// Regression: inline handler explicitly emits only 201; the contract declares
// response 200 on success. Comparator must still fire response.200 because the
// code-side responses list is non-empty (it has 201) — the "skip when empty"
// fix must not suppress drifts where response facts were actually extracted.
// IL-DRIFT: Operation:GET /catalog/items/broken / response.200
router.get('/catalog/items/broken', (req, res) => {
  res.status(201).json({ created: true });
});

export default router;
