import { Module } from "@nestjs/common";
import { ParentLinksService } from "./parent-links.service";
import { ParentLinksController } from "./parent-links.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [ParentLinksController],
  providers: [ParentLinksService],
})
export class ParentLinksModule {}
