import { IsEnum } from "class-validator";
import { ReviewStatus } from "@prisma/client";

// Only teacher/admin can set approved or rejected
export class ReviewProblemDto {
  @IsEnum(["approved", "rejected"])
  action: "approved" | "rejected";
}
