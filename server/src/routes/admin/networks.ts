import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { env } from '../../env';
import { audit } from '../../lib/audit';
import { HttpError } from '../../lib/http';
import { officeNetworkStatus } from '../../lib/network';
import { requireRole } from '../../middleware/auth';

/**
 * The office Wi-Fi networks that on-site check-ins must come from. Staff add the network they
 * are connected to ("this network"), so nobody needs to know the office's IP address.
 */
export const networksRouter = Router();

networksRouter.get('/', async (req, res) => {
  const [networks, current] = await Promise.all([
    prisma.officeNetwork.findMany({ orderBy: { createdAt: 'asc' }, include: { addedBy: { select: { name: true } } } }),
    officeNetworkStatus(req.ip),
  ]);
  res.json({
    policy: env.ONSITE_CHECKIN,
    current: { network: current.network, recognised: current.configured && current.onSite },
    networks: networks.map((n) => ({ id: n.id, network: n.network, label: n.label, addedBy: n.addedBy?.name ?? null, createdAt: n.createdAt })),
  });
});

networksRouter.post('/', requireRole('admin'), async (req, res) => {
  const { label } = z.object({ label: z.string().trim().min(2, 'Give the network a name').max(60) }).parse(req.body);
  const { network } = await officeNetworkStatus(req.ip);
  if (!network) throw new HttpError(400, 'Could not tell which network you are on.');
  if (await prisma.officeNetwork.findUnique({ where: { network } })) {
    throw new HttpError(409, 'This network is already added.');
  }
  const created = await prisma.officeNetwork.create({ data: { network, label, addedById: req.staff!.id } });
  await audit(req, 'OFFICE_NETWORK_ADD', { network, label });
  res.status(201).json({ id: created.id, network });
});

networksRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const network = await prisma.officeNetwork.findUnique({ where: { id } });
  if (!network) throw new HttpError(404, 'Network not found.');
  await prisma.officeNetwork.delete({ where: { id } });
  await audit(req, 'OFFICE_NETWORK_REMOVE', { network: network.network, label: network.label });
  res.status(204).end();
});
