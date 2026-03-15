-- StudentWeaknessProfile
CREATE TABLE "public"."student_weakness_profiles" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "errorPatterns" JSONB NOT NULL,
  "rootCauses" JSONB NOT NULL,
  "aiSummary" TEXT,
  "aiSummaryModel" TEXT,
  "lastRecommendedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "student_weakness_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_weakness_profiles_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "student_weakness_profiles_studentId_key" ON "public"."student_weakness_profiles"("studentId");

-- StudentWeaknessUnit
CREATE TABLE "public"."student_weakness_units" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "unit_major" TEXT NOT NULL,
  "accuracy" DOUBLE PRECISION NOT NULL,
  "attempt_count" INTEGER NOT NULL,
  "top_error_type" TEXT,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "student_weakness_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_weakness_units_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "public"."student_weakness_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "student_weakness_units_profileId_subject_unit_major_key" ON "public"."student_weakness_units"("profileId", "subject", "unit_major");
CREATE INDEX "student_weakness_units_subject_unit_major_idx" ON "public"."student_weakness_units"("subject", "unit_major");
