import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async create(name: string) {
    return this.prisma.organization.create({ data: { name } });
  }

  async findAll() {
    return this.prisma.organization.findMany();
  }

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: { users: { select: { id: true, name: true, role: true } } },
    });
    if (!org) throw new NotFoundException("Organization not found");
    return org;
  }
}
