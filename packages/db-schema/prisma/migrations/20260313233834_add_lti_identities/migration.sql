CREATE TABLE "public"."lti_identities" (
    "id" TEXT NOT NULL,
    "platform_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lti_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lti_identities_platform_id_subject_key" ON "public"."lti_identities"("platform_id", "subject");
CREATE UNIQUE INDEX "lti_identities_platform_id_user_id_key" ON "public"."lti_identities"("platform_id", "user_id");
CREATE INDEX "lti_identities_user_id_idx" ON "public"."lti_identities"("user_id");

ALTER TABLE "public"."lti_identities"
ADD CONSTRAINT "lti_identities_platform_id_fkey"
FOREIGN KEY ("platform_id") REFERENCES "public"."lti_platforms"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."lti_identities"
ADD CONSTRAINT "lti_identities_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
