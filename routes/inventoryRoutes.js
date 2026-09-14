import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import { listLots, stockSummary, stockIn, adjustStock, listTransactions } from '../controllers/inventoryController.js';

const router = Router();
router.use(protect, requireClinicUser, attachBranchContext);

router.get('/summary', requirePermission(P.INVENTORY_VIEW, P.INVENTORY_MANAGE), stockSummary);
router.get('/lots', requirePermission(P.INVENTORY_VIEW, P.INVENTORY_MANAGE), listLots);
router.get('/transactions', requirePermission(P.INVENTORY_VIEW, P.INVENTORY_MANAGE), listTransactions);
router.post('/stock-in', requirePermission(P.INVENTORY_MANAGE), stockIn);
router.post('/adjust', requirePermission(P.INVENTORY_MANAGE), adjustStock);

export default router;
