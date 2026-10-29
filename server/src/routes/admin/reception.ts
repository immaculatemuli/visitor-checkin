import { Router } from 'express';
import { env } from '../../env';
import { audit } from '../../lib/audit';
import { changeReceptionCode, receptionCode } from '../../lib/reception';
import { requireRole } from '../../middleware/auth';

/** The reception QR code, for printing the poster. Only staff can see it. */
export const receptionRouter = Router();

receptionRouter.get('/', async (_req, res) => {
  res.json({ code: await receptionCode(), required: env.REQUIRE_RECEPTION_SCAN });
});

// A new code makes the old poster (and any photo of it) stop working; reprint afterwards.
receptionRouter.post('/change', requireRole('admin'), async (req, res) => {
  const code = await changeReceptionCode();
  await audit(req, 'RECEPTION_CODE_CHANGE');
  res.json({ code, required: env.REQUIRE_RECEPTION_SCAN });
});
