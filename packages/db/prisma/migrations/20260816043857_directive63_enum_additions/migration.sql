-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActionFormStatus" ADD VALUE 'READY_FOR_HR_REVIEW';
ALTER TYPE "ActionFormStatus" ADD VALUE 'HR_REVIEWED';
ALTER TYPE "ActionFormStatus" ADD VALUE 'COMPLETE';
ALTER TYPE "ActionFormStatus" ADD VALUE 'RETURNED_FOR_CORRECTION';

-- AlterEnum
ALTER TYPE "AttestationKind" ADD VALUE 'HR_FORM_COMPLETION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExceptionType" ADD VALUE 'RECIPIENT_MISSING';
ALTER TYPE "ExceptionType" ADD VALUE 'BENEFITS_APPLICABILITY_UNKNOWN';
ALTER TYPE "ExceptionType" ADD VALUE 'ACKNOWLEDGEMENT_OVERDUE';
ALTER TYPE "ExceptionType" ADD VALUE 'AUTO_SEND_BLOCKED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationStatus" ADD VALUE 'SENT';
ALTER TYPE "NotificationStatus" ADD VALUE 'ACKNOWLEDGED';
ALTER TYPE "NotificationStatus" ADD VALUE 'CONFIRMED_COMPLETE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PAYROLL_OR_BANK_NOTIFICATION';
ALTER TYPE "NotificationType" ADD VALUE 'OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RecipientClassDir" ADD VALUE 'PAYROLL_BANK';
ALTER TYPE "RecipientClassDir" ADD VALUE 'PENSION_PROVIDER';
