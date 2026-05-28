/**
 * Debit one visit when note generation completes. Best-effort — a failure
 * here does not fail the worker (the draft is already useful); audit +
 * ledger row capture the miss for ops follow-up.
 */

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { getVisitDebitContextForOrg } from '@/lib/billing/capacity-gate';
import { debitForNote, VisitLedgerError } from '@/lib/billing/visit-ledger';

export async function debitVisitOnNoteGeneration(orgId: string, noteId: string): Promise<void> {
  const debitContext = await getVisitDebitContextForOrg(orgId);
  if (!debitContext) return;

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId },
    select: { clinicianOrgUserId: true },
  });
  if (!note?.clinicianOrgUserId) return;

  try {
    const result = await debitForNote({
      orgId,
      orgUserId: note.clinicianOrgUserId,
      noteId,
      visitDebitOrder: debitContext.visitDebitOrder,
      allowOverage: debitContext.allowOverage,
    });
    if (result.debited && !result.duplicate) {
      await writeAuditLog({
        orgId,
        action: 'VISIT_LEDGER_DEBIT',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: {
          amount: 1,
          orgBankBalance: result.orgBankBalance,
          userWalletBalance: result.userWalletBalance,
          debitedFrom: result.debitedFrom,
          overage: result.overage ?? false,
        },
      });
    }
  } catch (err) {
    const code = err instanceof VisitLedgerError ? err.code : 'unknown';
    await writeAuditLog({
      orgId,
      action: 'VISIT_LEDGER_CREDIT',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: {
        direction: 'debit_failed',
        errorCode: code,
      },
    });
  }
}
