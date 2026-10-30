import { createApp } from './app';
import { bootstrapAdmin, recoverAdmin } from './bootstrap';
import { prisma } from './db';
import { env } from './env';
import { startJobs } from './jobs';

const server = createApp().listen(env.PORT, () => {
  console.log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

bootstrapAdmin()
  .then(recoverAdmin)
  .catch((err) => console.error('[bootstrap] failed', err));
if (env.ENABLE_JOBS) startJobs();

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
