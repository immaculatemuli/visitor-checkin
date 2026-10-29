import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// Header chains as seen on Render: client, Cloudflare edge, Render's router (from a loopback proxy).
async function clientIpOnRender(forwardedFor: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv('RENDER', 'true');
  const { trustProxySetting } = await import('../src/lib/proxy');
  vi.unstubAllEnvs();
  const app = express();
  app.set('trust proxy', trustProxySetting());
  app.get('/ip', (req, res) => {
    res.send(req.ip);
  });
  const res = await request(app).get('/ip').set('X-Forwarded-For', forwardedFor);
  return res.text;
}

describe('client address on Render', () => {
  it('finds the visitor behind Cloudflare and Render', async () => {
    expect(await clientIpOnRender('197.254.106.222, 104.22.77.144, 10.31.127.154')).toBe('197.254.106.222');
  });

  it('ignores an address the client added to the header', async () => {
    expect(await clientIpOnRender('6.6.6.6, 197.254.106.222, 104.22.77.144, 10.31.127.154')).toBe('197.254.106.222');
  });

  it('handles IPv6 visitors and Cloudflare IPv6 edges', async () => {
    expect(await clientIpOnRender('2c0f:fe38:2::1, 2400:cb00:2049::1, 10.29.248.125')).toBe('2c0f:fe38:2::1');
  });
});
