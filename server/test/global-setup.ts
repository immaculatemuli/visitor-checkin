import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

// Applies migrations to the test database once before the suite runs.
export default function setup() {
  if (!existsSync('.env.test')) return;
  const { parsed } = dotenv.config({ path: '.env.test', override: true });
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, ...parsed } });
}
