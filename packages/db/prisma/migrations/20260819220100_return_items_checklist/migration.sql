-- Exit Checklist for Return Items (owner directive, 2026-08-19): the digital
-- form of the HR paper checklist. Additive only - no existing table changes.
-- CreateEnum
CREATE TYPE "ReturnItemKey" AS ENUM ('IDENTIFICATION_CARD', 'HEALTH_CARDS', 'ACCESS_CARD_DOOR_PASS', 'UNIFORMS', 'LAPTOP', 'EPAY_CARD', 'EMPLOYEE_HANDBOOK', 'PHONE', 'KEYS_DESK', 'KEYS_DOOR');

-- CreateEnum
CREATE TYPE "ReturnItemStatus" AS ENUM ('OUTSTANDING', 'RETURNED', 'NOT_RETURNED', 'NOT_APPLICABLE', 'LOST_OR_DAMAGED');

-- CreateEnum
CREATE TYPE "ReturnChecklistStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED_WITH_OUTSTANDING');

-- CreateTable
CREATE TABLE "return_items_checklist" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "status" "ReturnChecklistStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "sentAt" TIMESTAMP(3),
    "sentToName" TEXT,
    "sentToMask" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedByName" TEXT,
    "submittedByUserId" UUID,
    "receivedByName" TEXT,
    "receivedAt" TIMESTAMP(3),
    "employeeAcknowledgedAt" TIMESTAMP(3),
    "employeeAcknowledgedBy" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_items_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items_checklist_entry" (
    "id" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "itemKey" "ReturnItemKey" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" "ReturnItemStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "remarks" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_items_checklist_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "return_items_checklist_caseId_key" ON "return_items_checklist"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "return_items_checklist_entry_checklistId_itemKey_key" ON "return_items_checklist_entry"("checklistId", "itemKey");

-- AddForeignKey
ALTER TABLE "return_items_checklist" ADD CONSTRAINT "return_items_checklist_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "offboarding_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items_checklist_entry" ADD CONSTRAINT "return_items_checklist_entry_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "return_items_checklist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
