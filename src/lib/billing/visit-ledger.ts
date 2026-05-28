/**
 * Visit ledger — org bank + per-user wallets.
 *
 * Positive `amount` credits; negative debits. Balances on Organization /
 * OrgUser are caches updated atomically with each append-only ledger row.
 */

import type {
  Prisma,
  VisitDebitOrder,
  VisitLedgerSourceType,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';

export type VisitLedgerTx = Prisma.TransactionClient;

export type CreditOrgBankInput = {
  orgId: string;
  amount: number;
  sourceType: VisitLedgerSourceType;
  sourceId?: string;
  idempotencyKey?: string;
  metadata?: Prisma.InputJsonValue;
  createdByUserId?: string;
  expiresAt?: Date;
};

export type TransferInput = {
  orgId: string;
  orgUserId: string;
  amount: number;
  createdByUserId?: string;
  metadata?: Prisma.InputJsonValue;
};

export type DebitNoteInput = {
  orgId: string;
  orgUserId: string;
  noteId: string;
  visitDebitOrder: VisitDebitOrder;
  createdByUserId?: string;
};

export class VisitLedgerError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'insufficient_balance'
      | 'invalid_amount'
      | 'org_user_not_found'
      | 'duplicate_idempotency',
  ) {
    super(message);
    this.name = 'VisitLedgerError';
  }
}

async function creditOrgBankTx(
  tx: VisitLedgerTx,
  input: CreditOrgBankInput,
): Promise<{ orgBankBalance: number; entryId: string }> {
  if (input.amount <= 0) {
    throw new VisitLedgerError('Credit amount must be positive', 'invalid_amount');
  }

  if (input.idempotencyKey) {
    const existing = await tx.visitLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, orgBankBalanceAfter: true },
    });
    if (existing) {
      return { orgBankBalance: existing.orgBankBalanceAfter, entryId: existing.id };
    }
  }

  const org = await tx.organization.update({
    where: { id: input.orgId },
    data: { visitBankBalance: { increment: input.amount } },
    select: { visitBankBalance: true },
  });

  const entry = await tx.visitLedgerEntry.create({
    data: {
      orgId: input.orgId,
      amount: input.amount,
      orgBankBalanceAfter: org.visitBankBalance,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt,
    },
  });

  return { orgBankBalance: org.visitBankBalance, entryId: entry.id };
}

export async function creditOrgBank(input: CreditOrgBankInput) {
  return prisma.$transaction((tx) => creditOrgBankTx(tx, input));
}

async function transferBankToWalletTx(tx: VisitLedgerTx, input: TransferInput) {
  if (input.amount <= 0) {
    throw new VisitLedgerError('Transfer amount must be positive', 'invalid_amount');
  }

  const orgUser = await tx.orgUser.findFirst({
    where: { id: input.orgUserId, orgId: input.orgId, isActive: true },
    select: { id: true },
  });
  if (!orgUser) {
    throw new VisitLedgerError('Org user not found', 'org_user_not_found');
  }

  const org = await tx.organization.findUnique({
    where: { id: input.orgId },
    select: { visitBankBalance: true },
  });
  if (!org || org.visitBankBalance < input.amount) {
    throw new VisitLedgerError('Insufficient org bank balance', 'insufficient_balance');
  }

  const updatedOrg = await tx.organization.update({
    where: { id: input.orgId },
    data: { visitBankBalance: { decrement: input.amount } },
    select: { visitBankBalance: true },
  });

  const updatedUser = await tx.orgUser.update({
    where: { id: input.orgUserId },
    data: { visitWalletBalance: { increment: input.amount } },
    select: { visitWalletBalance: true },
  });

  await tx.visitLedgerEntry.create({
    data: {
      orgId: input.orgId,
      orgUserId: input.orgUserId,
      amount: -input.amount,
      orgBankBalanceAfter: updatedOrg.visitBankBalance,
      userWalletBalanceAfter: updatedUser.visitWalletBalance,
      sourceType: 'ADMIN_ALLOCATE',
      metadata: input.metadata,
      createdByUserId: input.createdByUserId,
    },
  });

  return {
    orgBankBalance: updatedOrg.visitBankBalance,
    userWalletBalance: updatedUser.visitWalletBalance,
  };
}

export async function transferBankToWallet(input: TransferInput) {
  return prisma.$transaction((tx) => transferBankToWalletTx(tx, input));
}

async function transferWalletToBankTx(tx: VisitLedgerTx, input: TransferInput) {
  if (input.amount <= 0) {
    throw new VisitLedgerError('Reclaim amount must be positive', 'invalid_amount');
  }

  const orgUser = await tx.orgUser.findFirst({
    where: { id: input.orgUserId, orgId: input.orgId, isActive: true },
    select: { visitWalletBalance: true },
  });
  if (!orgUser) {
    throw new VisitLedgerError('Org user not found', 'org_user_not_found');
  }
  if (orgUser.visitWalletBalance < input.amount) {
    throw new VisitLedgerError('Insufficient user wallet balance', 'insufficient_balance');
  }

  const updatedUser = await tx.orgUser.update({
    where: { id: input.orgUserId },
    data: { visitWalletBalance: { decrement: input.amount } },
    select: { visitWalletBalance: true },
  });

  const updatedOrg = await tx.organization.update({
    where: { id: input.orgId },
    data: { visitBankBalance: { increment: input.amount } },
    select: { visitBankBalance: true },
  });

  await tx.visitLedgerEntry.create({
    data: {
      orgId: input.orgId,
      orgUserId: input.orgUserId,
      amount: input.amount,
      orgBankBalanceAfter: updatedOrg.visitBankBalance,
      userWalletBalanceAfter: updatedUser.visitWalletBalance,
      sourceType: 'ADMIN_RECLAIM',
      metadata: input.metadata,
      createdByUserId: input.createdByUserId,
    },
  });

  return {
    orgBankBalance: updatedOrg.visitBankBalance,
    userWalletBalance: updatedUser.visitWalletBalance,
  };
}

export async function transferWalletToBank(input: TransferInput) {
  return prisma.$transaction((tx) => transferWalletToBankTx(tx, input));
}

async function debitForNoteTx(tx: VisitLedgerTx, input: DebitNoteInput) {
  const idempotencyKey = `note-debit:${input.noteId}`;

  const existing = await tx.visitLedgerEntry.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (existing) {
    return { debited: false, duplicate: true };
  }

  const orgUser = await tx.orgUser.findFirst({
    where: { id: input.orgUserId, orgId: input.orgId },
    select: { visitWalletBalance: true },
  });
  if (!orgUser) {
    throw new VisitLedgerError('Org user not found', 'org_user_not_found');
  }

  const org = await tx.organization.findUnique({
    where: { id: input.orgId },
    select: { visitBankBalance: true },
  });
  if (!org) {
    throw new VisitLedgerError('Org not found', 'org_user_not_found');
  }

  let wallet = orgUser.visitWalletBalance;
  let bank = org.visitBankBalance;
  let debitedFrom: 'wallet' | 'bank';

  if (input.visitDebitOrder === 'USER_WALLET_THEN_BANK' && wallet >= 1) {
    wallet -= 1;
    debitedFrom = 'wallet';
    await tx.orgUser.update({
      where: { id: input.orgUserId },
      data: { visitWalletBalance: wallet },
    });
  } else if (bank >= 1) {
    bank -= 1;
    debitedFrom = 'bank';
    await tx.organization.update({
      where: { id: input.orgId },
      data: { visitBankBalance: bank },
    });
  } else {
    throw new VisitLedgerError('Insufficient visit balance', 'insufficient_balance');
  }

  await tx.visitLedgerEntry.create({
    data: {
      orgId: input.orgId,
      orgUserId: input.orgUserId,
      amount: -1,
      orgBankBalanceAfter: bank,
      userWalletBalanceAfter: wallet,
      sourceType: 'NOTE_DEBIT',
      sourceId: input.noteId,
      idempotencyKey,
      metadata: { debitedFrom },
      createdByUserId: input.createdByUserId,
    },
  });

  return {
    debited: true,
    duplicate: false,
    orgBankBalance: bank,
    userWalletBalance: wallet,
    debitedFrom,
  };
}

export async function debitForNote(input: DebitNoteInput) {
  return prisma.$transaction((tx) => debitForNoteTx(tx, input));
}

export async function getOrgUserAvailableVisits(
  orgId: string,
  orgUserId: string,
  visitDebitOrder: VisitDebitOrder,
): Promise<number> {
  const [org, orgUser] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { visitBankBalance: true },
    }),
    prisma.orgUser.findFirst({
      where: { id: orgUserId, orgId },
      select: { visitWalletBalance: true },
    }),
  ]);
  if (!org || !orgUser) return 0;
  if (visitDebitOrder === 'BANK_ONLY') return org.visitBankBalance;
  return orgUser.visitWalletBalance + org.visitBankBalance;
}
