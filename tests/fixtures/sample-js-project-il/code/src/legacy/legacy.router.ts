import express from 'express';

const router = express.Router();

// Regression guard: this route genuinely has no auth middleware.
// The auth requirement contract covers /internal/** — any unprotected
// route there SHOULD fire a drift.
// IL-DRIFT: AuthRequirement:auth.bearer.internal / GET /internal/legacy/{id}/unprotected
router.get('/internal/legacy/:id', (req, res) => {
  res.json({ id: req.params.id });
});

export default router;
