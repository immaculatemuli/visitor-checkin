-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('national_id', 'passport');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('PENDING_APPROVAL', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('SELF', 'RETURNING', 'MANUAL');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('admin', 'security');

-- CreateTable
CREATE TABLE "visitors" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "document_number_hash" TEXT NOT NULL,
    "document_last4" TEXT NOT NULL,
    "nationality" TEXT,
    "dob" DATE,
    "document_expiry" DATE,
    "phone" TEXT NOT NULL,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "consent_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL,
    "visitor_id" UUID NOT NULL,
    "host_name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "pass_number" TEXT NOT NULL,
    "status" "VisitStatus" NOT NULL,
    "method" "CheckInMethod" NOT NULL,
    "check_in_at" TIMESTAMP(3),
    "check_out_at" TIMESTAMP(3),
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" TEXT,
    "watchlist_hit" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "resolved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist" (
    "id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "document_number_hash" TEXT NOT NULL,
    "document_last4" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "added_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "staff_id" UUID,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "visitor_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visitors_document_number_hash_key" ON "visitors"("document_number_hash");

-- CreateIndex
CREATE INDEX "visitors_phone_idx" ON "visitors"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "visits_pass_number_key" ON "visits"("pass_number");

-- CreateIndex
CREATE INDEX "visits_visitor_id_status_idx" ON "visits"("visitor_id", "status");

-- CreateIndex
CREATE INDEX "visits_status_idx" ON "visits"("status");

-- CreateIndex
CREATE INDEX "visits_created_at_idx" ON "visits"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_document_number_hash_key" ON "watchlist"("document_number_hash");

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_key" ON "staff"("email");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_hash_key" ON "device_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "device_tokens_visitor_id_idx" ON "device_tokens"("visitor_id");

-- CreateIndex
CREATE INDEX "otp_codes_phone_created_at_idx" ON "otp_codes"("phone", "created_at");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

