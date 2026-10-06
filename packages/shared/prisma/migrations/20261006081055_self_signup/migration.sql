-- CreateEnum
CREATE TYPE "SignupMode" AS ENUM ('INVITE_ONLY', 'OPEN');

-- AlterTable
ALTER TABLE "InstanceConfig" ADD COLUMN     "signupAllowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "signupMode" "SignupMode" NOT NULL DEFAULT 'INVITE_ONLY';

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "requestedIp" TEXT,
ADD COLUMN     "selfSignup" BOOLEAN NOT NULL DEFAULT false;
