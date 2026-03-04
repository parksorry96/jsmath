import { IsString, IsOptional } from "class-validator";

export class EnrollDto {
  // Teacher enrolling a specific student; omitted means self-enroll
  @IsString()
  @IsOptional()
  userId?: string;
}
