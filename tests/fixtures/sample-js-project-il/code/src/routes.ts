import express from 'express';
import ordersController from './controllers/orders.controller.js';
import customersController from './controllers/customers.controller.js';
import { requireBearer, requireRole } from './middleware/auth.middleware.js';

const router = express.Router();

// Orders surface — bearer auth required for every operation.
const ordersRouter = express.Router();
ordersRouter.use(requireBearer);
ordersRouter.use(ordersController);
router.use('/api', ordersRouter);

// Spec: every endpoint under /api/* requires a Bearer token. The
// customers router below mounts customersController WITHOUT the
// requireBearer middleware, so POST /api/customers, GET /api/customers,
// GET /api/customers/:id are all reachable anonymously.
// IL-DRIFT: AuthRequirement:auth.bearer.api / POST /api/customers/unprotected
// IL-DRIFT: AuthRequirement:auth.bearer.api / GET /api/customers/unprotected
// IL-DRIFT: AuthRequirement:auth.bearer.api / GET /api/customers/{id}/unprotected
// IL-DRIFT: AuthRequirement:auth.role.admin / POST /api/customers/unprotected
const customersRouter = express.Router();
// Note: requireRole('admin') without requireBearer is meaningless — req.auth
// is never populated, so the role check trivially fails open or fails-closed
// depending on the role-middleware impl. Either way, no auth is enforced.
customersRouter.use(customersController);
router.use('/api', customersRouter);

// Marker — admin-role middleware exists but is currently unused. Left in
// so the IL artifact `AuthRequirement:auth.role.admin` still has a code
// referent we can verify against.
void requireRole;

export default router;
