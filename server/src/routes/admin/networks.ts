import { isIPv4 } from 'node:net';
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

const BLOCKED_DAYS = 7;

/**
 * Networks check-ins were refused from in the last week, newest first, so an admin can approve
 * the office's other addresses (a second internet line, or IPv6 alongside IPv4) from any device.
 */
async function recentlyBlocked(known: Set<string>) {
  const logs = await prisma.auditLog.findMany({
    where: { action: 'OFFSITE_CHECKIN_BLOCKED', createdAt: { gte: new Date(Date.now() - BLOCKED_DAYS * 86_400_000) } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const byNetwork = new Map<string, { network: string; attempts: number; lastAt: Date; names: string[] }>();
  for (const log of logs) {
    const { network, name } = (log.details ?? {}) as { network?: string; name?: string };
    if (!network || known.has(network)) continue;
    const entry = byNetwork.get(network) ?? { network, attempts: 0, lastAt: log.createdAt, names: [] };
    entry.attempts++;
    if (name && !entry.names.includes(name) && entry.names.length < 3) entry.names.push(name);
    byNetwork.set(network, entry);
  }
  return [...byNetwork.values()].slice(0, 20);
}

networksRouter.get('/', async (req, res) => {
  const [networks, current] = await Promise.all([
    prisma.officeNetwork.findMany({ orderBy: { createdAt: 'asc' }, include: { addedBy: { select: { name: true } } } }),
    officeNetworkStatus(req.ip),
  ]);
  res.json({
    policy: env.ONSITE_CHECKIN,
    current: { network: current.network, recognised: current.configured && current.onSite },
    networks: networks.map((n) => ({ id: n.id, network: n.network, label: n.label, addedBy: n.addedBy?.name ?? null, createdAt: n.createdAt })),
    blocked: await recentlyBlocked(new Set(networks.map((n) => n.network))),
  });
});

// A network as stored by networkOf(): an IPv4 address, or an IPv6 /64 prefix.
const storedNetwork = z
  .string()
  .trim()
  .refine((v) => isIPv4(v) || /^([0-9a-f]{1,4}:){4}:\/64$/.test(v), 'Not a valid network');

/** Adds the network the admin is on now, or (from the refused list) a given one. */
networksRouter.post('/', requireRole('admin'), async (req, res) => {
  const input = z
    .object({ label: z.string().trim().min(2, 'Give the network a name').max(60), network: storedNetwork.optional() })
    .parse(req.body);
  const label = input.label;
  const network = input.network ?? (await officeNetworkStatus(req.ip)).network;
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
