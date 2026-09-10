import { Router } from 'express';

const router = Router();

const gone = (_req, res) =>
  res.status(410).json({
    success: false,
    message: 'Patient ratings are disabled. This product no longer supports patient accounts.',
  });

router.get('/doctor/:doctorId', gone);
router.get('/mine/:doctorId', gone);
router.post('/', gone);

export default router;
