-- AlterTable: make passwordHash nullable for social login users
ALTER TABLE "public"."users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- AddColumn: social auth provider
ALTER TABLE "public"."users" ADD COLUMN "provider" TEXT;

-- AddColumn: provider-specific account ID
ALTER TABLE "public"."users" ADD COLUMN "provider_account_id" TEXT;

-- AddColumn: student grade level
ALTER TABLE "public"."users" ADD COLUMN "grade_level" TEXT;

-- AddColumn: curriculum year (2015 or 2022)
ALTER TABLE "public"."users" ADD COLUMN "curriculum_year" INTEGER;

-- CreateIndex: compound unique on provider + providerAccountId
CREATE UNIQUE INDEX "users_provider_provider_account_id_key" ON "public"."users"("provider", "provider_account_id");
