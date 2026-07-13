import express from 'express';
import { requireOpsAgent } from './auth.js';
import appointmentsController from './appointments.controller.js';
import refundsController from './refunds.controller.js';

const router = express.Router();

// Every /ops/* endpoint requires an Okta session with the ops-agent role (ADR 0001).
router.use(requireOpsAgent);
router.use(appointmentsController);
router.use(refundsController);

export default router;
