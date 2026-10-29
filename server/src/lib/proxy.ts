import { env } from '../env';

// Cloudflare's published edge ranges (https://www.cloudflare.com/ips/). Render serves every web
// service through Cloudflare, so these sit between the visitor and the app.
const CLOUDFLARE = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/**
 * Express's 'trust proxy' setting. On Render a request passes Cloudflare, Render's router and a
 * local proxy, so instead of counting hops the app trusts exactly those: loopback, private
 * networks and Cloudflare. The client address is then the first one in X-Forwarded-For that
 * isn't one of them, and anything a client prepends to the header is ignored. Elsewhere,
 * TRUST_PROXY gives the number of proxies.
 */
export function trustProxySetting(): number | string[] {
  return env.RENDER ? ['loopback', 'linklocal', 'uniquelocal', ...CLOUDFLARE] : env.TRUST_PROXY;
}
