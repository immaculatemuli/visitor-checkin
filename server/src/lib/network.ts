import { isIPv4, isIPv6 } from 'node:net';
import { prisma } from '../db';

/** The client address as Express reports it, without the IPv4-in-IPv6 wrapper (::ffff:1.2.3.4). */
export function normalizeIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const plain = ip.replace(/^::ffff:/i, '');
  return isIPv4(plain) || isIPv6(plain) ? plain : null;
}

/** Expands an IPv6 address to its eight groups ("2001:db8::1" -> ["2001","db8","0",...,"1"]). */
function ipv6Groups(ip: string): string[] {
  const [head, tail] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  return groups.map((g) => (parseInt(g, 16) || 0).toString(16));
}

/**
 * The network an address belongs to, as stored for the office. Behind the office router every
 * phone shares one public IPv4 address; with IPv6 each phone has its own address but they all
 * share the network's /64 prefix.
 */
export function networkOf(ip: string): string {
  if (isIPv4(ip)) return ip;
  return `${ipv6Groups(ip).slice(0, 4).join(':')}::/64`;
}

/**
 * Whether a request comes from the office Wi-Fi. `configured` is false until an admin adds the
 * office network, in which case nothing is restricted.
 */
export async function officeNetworkStatus(ip: string | undefined): Promise<{ configured: boolean; onSite: boolean; network: string | null }> {
  const plain = normalizeIp(ip);
  const network = plain ? networkOf(plain) : null;
  const networks = await prisma.officeNetwork.findMany({ select: { network: true } });
  if (networks.length === 0) return { configured: false, onSite: true, network };
  return { configured: true, onSite: !!network && networks.some((n) => n.network === network), network };
}
