-- The employer's own Employee # from BambooHR, snapshotted onto the case with
-- the rest of the source data.
--
-- employeeSourceId is BambooHR's INTERNAL record id and means nothing to HR;
-- it was being shown and printed as if it were the employee number. Null
-- where BambooHR holds no number for a person - the platform never invents
-- one, and a letter shows nothing rather than the wrong number.
ALTER TABLE "offboarding_case" ADD COLUMN "employeeNumber" TEXT;
