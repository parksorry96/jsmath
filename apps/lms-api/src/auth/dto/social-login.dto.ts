import { IsIn, IsString } from "class-validator";

export class SocialLoginDto {
  @IsString()
  @IsIn(["kakao", "apple", "google"])
  provider: "kakao" | "apple" | "google";

  @IsString()
  accessToken: string;
}
