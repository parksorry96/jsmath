import { PrismaService } from "../prisma/prisma.service";

export function isAdminRole(role: string): boolean {
  return role === "admin";
}

export function isTeacherRole(role: string): boolean {
  return role === "teacher";
}

export function isPrivilegedRole(role: string): boolean {
  return isAdminRole(role) || isTeacherRole(role);
}

export async function getRequesterOrganizationId(
  prisma: PrismaService,
  requesterId: string,
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { organizationId: true },
  });
  return user?.organizationId ?? null;
}

export async function getLinkedStudentIds(
  prisma: PrismaService,
  parentId: string,
): Promise<string[]> {
  const links = await prisma.parentStudent.findMany({
    where: { parentId },
    select: { studentId: true },
  });

  return links.map((link) => link.studentId);
}

export async function getAccessibleClassIds(
  prisma: PrismaService,
  requesterId: string,
  requesterRole: string,
): Promise<string[] | null> {
  if (isAdminRole(requesterRole)) {
    return null;
  }

  if (isTeacherRole(requesterRole)) {
    const organizationId = await getRequesterOrganizationId(prisma, requesterId);
    const classes = await prisma.class.findMany({
      where: {
        deletedAt: null,
        organizationId,
      },
      select: { id: true },
    });
    return classes.map((cls) => cls.id);
  }

  if (requesterRole === "student") {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: requesterId },
      select: { classId: true },
    });
    return enrollments.map((enrollment) => enrollment.classId);
  }

  if (requesterRole === "parent") {
    const studentIds = await getLinkedStudentIds(prisma, requesterId);
    if (studentIds.length === 0) {
      return [];
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { userId: { in: studentIds } },
      select: { classId: true },
      distinct: ["classId"],
    });
    return enrollments.map((enrollment) => enrollment.classId);
  }

  return [];
}

export async function canAccessClass(
  prisma: PrismaService,
  requesterId: string,
  requesterRole: string,
  classId: string,
): Promise<boolean> {
  const accessibleClassIds = await getAccessibleClassIds(
    prisma,
    requesterId,
    requesterRole,
  );

  return accessibleClassIds === null || accessibleClassIds.includes(classId);
}

export async function canAccessAssignment(
  prisma: PrismaService,
  requesterId: string,
  requesterRole: string,
  assignmentId: string,
): Promise<boolean> {
  if (isAdminRole(requesterRole)) {
    return true;
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { classId: true },
  });

  if (!assignment) {
    return false;
  }

  return canAccessClass(
    prisma,
    requesterId,
    requesterRole,
    assignment.classId,
  );
}

export async function canAccessSubmission(
  prisma: PrismaService,
  requesterId: string,
  requesterRole: string,
  submissionId: string,
): Promise<boolean> {
  if (isAdminRole(requesterRole)) {
    return true;
  }

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      studentId: true,
      assignment: {
        select: {
          class: {
            select: { organizationId: true },
          },
        },
      },
    },
  });

  if (!submission) {
    return false;
  }

  if (isTeacherRole(requesterRole)) {
    const organizationId = await getRequesterOrganizationId(prisma, requesterId);
    return submission.assignment.class.organizationId === organizationId;
  }

  if (requesterRole === "student") {
    return submission.studentId === requesterId;
  }

  if (requesterRole === "parent") {
    const studentIds = await getLinkedStudentIds(prisma, requesterId);
    return studentIds.includes(submission.studentId);
  }

  return false;
}

export async function canAccessStudentData(
  prisma: PrismaService,
  requesterId: string,
  requesterRole: string,
  studentId: string,
): Promise<boolean> {
  if (isAdminRole(requesterRole)) {
    return true;
  }

  if (isTeacherRole(requesterRole)) {
    const [teacherOrganizationId, student] = await Promise.all([
      getRequesterOrganizationId(prisma, requesterId),
      prisma.user.findUnique({
        where: { id: studentId },
        select: { organizationId: true },
      }),
    ]);
    return student?.organizationId === teacherOrganizationId;
  }

  if (requesterRole === "student") {
    return requesterId === studentId;
  }

  if (requesterRole === "parent") {
    const studentIds = await getLinkedStudentIds(prisma, requesterId);
    return studentIds.includes(studentId);
  }

  return false;
}
