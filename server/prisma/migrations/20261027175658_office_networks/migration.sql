-- CreateTable
CREATE TABLE "office_networks" (
    "id" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "added_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "office_networks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "office_networks_network_key" ON "office_networks"("network");

-- AddForeignKey
ALTER TABLE "office_networks" ADD CONSTRAINT "office_networks_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
