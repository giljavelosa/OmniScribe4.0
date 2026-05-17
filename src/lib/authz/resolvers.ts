import { prisma } from '@/lib/prisma';

export function getOrgUserById(orgUserId: string) {
  return prisma.orgUser.findUnique({ where: { id: orgUserId } });
}

export function getOrgUserByUserAndOrg(userId: string, orgId: string) {
  return prisma.orgUser.findUnique({ where: { userId_orgId: { userId, orgId } } });
}
