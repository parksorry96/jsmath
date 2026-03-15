import { IsString, IsNotEmpty } from "class-validator";

export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  problemId: string;
}
