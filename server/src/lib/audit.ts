import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../db';

export async function audit(
  req: Request | null,
  action: string,
  details?: Prisma.InputJsonValue,
  staffId: string | null = req?.staff?.id ?? null,
): Promise<void> {
  await prisma.auditLog.create({
    data: { staffId, action, details, ip: req?.ip ?? null },
  });
}
