import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { attachBranchContext, requirePermission, requireClinicUser, asyncHandler } from '../middleware/access.js';
import { P } from '../utils/permissions.js';
import {
  getPrintSettings,
  updatePrintSettings,
  uploadPrintAsset,
  printPreview,
  printPayload,
} from '../controllers/printController.js';
import { globalSearch } from '../controllers/searchController.js';
import AuditLog from '../models/AuditLog.js';
import { tenantFilter } from '../utils/branchScope.js';
import { parsePagination, paginated } from '../utils/pagination.js';
import { uploadPrintImage } from '../middleware/uploadPrintImage.js';

const router = Router();
router.use(protect, requireClinicUser, attachBranchContext);

router.get('/print/settings', requirePermission(P.PRINT_SETTINGS, P.BILLING_VIEW, P.CONSULTATION), getPrintSettings);
router.put('/print/settings', requirePermission(P.PRINT_SETTINGS), updatePrintSettings);
router.post(
  '/print/settings/upload',
  requirePermission(P.PRINT_SETTINGS),
  (req, res, next) => {
    uploadPrintImage(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message || 'Upload failed.' });
      }
      next();
    });
  },
  uploadPrintAsset
);
router.get(
  '/print/preview',
  requirePermission(P.PRINT_SETTINGS, P.BILLING_VIEW, P.CONSULTATION),
  printPreview
);
router.get('/print/:type/:id', requirePermission(P.BILLING_VIEW, P.CONSULTATION, P.APPOINTMENTS_VIEW), printPayload);
router.get('/search', requirePermission(P.SEARCH), globalSearch);

router.get(
  '/audit',
  requirePermission(P.AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = tenantFilter(req.user, req.branchId);
    if (req.query.action) filter.action = req.query.action;
    const [rows, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actorId', 'name role'),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ success: true, ...paginated({ items: rows, total, page, limit }), logs: rows });
  })
);

export default router;
