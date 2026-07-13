import express from 'express';
import { requireCustomer } from './auth.js';
import providersController from './providers.controller.js';
import appointmentsController from './appointments.controller.js';

const router = express.Router();

// Every /api/* endpoint requires a customer Bearer JWT (ADR 0001).
router.use(requireCustomer);
router.use(providersController);
router.use(appointmentsController);

export default router;
