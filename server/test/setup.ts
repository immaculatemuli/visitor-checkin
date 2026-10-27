import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

if (!existsSync('.env.test')) {
  throw new Error('server/.env.test not found. Copy .env.test.example and point it at a test database.');
}
dotenv.config({ path: '.env.test', override: true });
