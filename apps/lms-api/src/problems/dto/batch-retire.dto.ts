import { IsArray, IsString, ArrayMaxSize, ArrayMinSize } from 'class-validator';

export class BatchRetireDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  ids: string[];
}
