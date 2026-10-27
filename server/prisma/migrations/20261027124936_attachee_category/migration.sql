-- CreateEnum
CREATE TYPE "VisitCategory" AS ENUM ('visitor', 'attachee');

-- DropIndex
DROP INDEX "visits_status_idx";

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "category" "VisitCategory" NOT NULL DEFAULT 'visitor',
ALTER COLUMN "host_name" DROP NOT NULL,
ALTER COLUMN "purpose" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "visits_status_category_idx" ON "visits"("status", "category");
