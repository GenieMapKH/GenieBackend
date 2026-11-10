import { BadRequestException } from '@nestjs/common';
import { TakeoverDto } from './dto/takeover.dto';
import { MAX_MONEY } from './dto/numeric-limits';
import { TAKEOVER_LISTING_TYPE } from './property-options';

/** Accepts validated input or a stored row (Prisma decimals/dates included). */
type Terms = Partial<Record<keyof TakeoverDto, unknown>>;
export type TakeoverListing = {
  listingType?: string | null;
  takeover?: Terms | null;
  discountValue?: unknown;
};

export function takeoverPrice(terms?: Terms | null): number | undefined {
  if (terms?.sellerAmount == null || terms.remainingBalance == null) return;
  const total =
    (Math.round(Number(terms.sellerAmount) * 100) +
      Math.round(Number(terms.remainingBalance) * 100)) /
    100;
  if (!Number.isFinite(total) || total > MAX_MONEY) {
    throw new BadRequestException('The combined takeover price is too large.');
  }
  return total;
}

/** Every route that makes a listing public uses the same completeness check. */
export function assertTakeoverComplete(listing: TakeoverListing): void {
  if (listing.listingType !== TAKEOVER_LISTING_TYPE) return;
  const t = listing.takeover;
  const missing = [
    'providerType',
    'providerName',
    'sellerAmount',
    'remainingBalance',
    'balanceAsOf',
    'paymentAmount',
    'paymentFrequency',
    'remainingMonths',
    'nextPaymentDate',
    'interestType',
    'transferStatus',
    'transferFeePayer',
    'arrearsAmount',
    'hasAdditionalPayments',
  ].filter(
    (key) =>
      t?.[key as keyof TakeoverDto] == null ||
      String(t[key as keyof TakeoverDto]).trim() === '',
  );
  if (missing.length || !t) {
    throw new BadRequestException(
      'Complete the takeover payment details before publishing.',
    );
  }
  if (Number(t.remainingBalance) <= 0 || Number(t.paymentAmount) <= 0) {
    throw new BadRequestException(
      'The remaining balance and regular payment must be positive.',
    );
  }
  if (
    t.providerType === 'Developer' &&
    (typeof t.projectName !== 'string' || !t.projectName.trim())
  ) {
    throw new BadRequestException('Enter the developer project name.');
  }
  if (
    ['Fixed', 'Variable'].includes(String(t.interestType)) &&
    t.annualInterestRate == null
  ) {
    throw new BadRequestException('Enter the current annual interest rate.');
  }
  if (t.interestType === 'None' && Number(t.annualInterestRate ?? 0) !== 0) {
    throw new BadRequestException(
      'An interest-free plan cannot have an interest rate.',
    );
  }
  if (t.transferStatus === 'Not allowed') {
    throw new BadRequestException(
      'A contract that cannot be transferred cannot be published as a takeover.',
    );
  }
  if (Number(t.arrearsAmount) > 0 && !t.arrearsPayer) {
    throw new BadRequestException(
      'Specify who will settle the overdue payments.',
    );
  }
  if (
    Number(t.arrearsAmount) > 0 &&
    (typeof t.notes !== 'string' || !t.notes.trim())
  ) {
    throw new BadRequestException(
      'Explain whether the overdue amount is already included in the remaining balance.',
    );
  }
  if (Number(listing.discountValue ?? 0) !== 0) {
    throw new BadRequestException(
      'Set the seller amount directly instead of a takeover discount.',
    );
  }
  const extras = (t.additionalPayments ?? []) as {
    amount: unknown;
    dueDate: unknown;
  }[];
  if (
    (t.hasAdditionalPayments === true && extras.length === 0) ||
    (t.hasAdditionalPayments === false && extras.length > 0)
  ) {
    throw new BadRequestException(
      'Confirm and enter any additional scheduled payments.',
    );
  }
  if (
    extras.some(
      (payment) =>
        payment.amount == null ||
        Number(payment.amount) <= 0 ||
        !payment.dueDate,
    )
  ) {
    throw new BadRequestException(
      'Enter the amount and date of each additional scheduled payment.',
    );
  }
  const extraTotal = extras.reduce(
    (sum, payment) => sum + Math.round(Number(payment.amount) * 100),
    0,
  );
  if (extraTotal > Math.round(Number(t.remainingBalance) * 100)) {
    throw new BadRequestException(
      'Additional scheduled payments must already be included in the remaining balance.',
    );
  }
  takeoverPrice(t);
}

/** A supplied takeover object replaces the previous terms, including cleared fields. */
export function takeoverData(dto: TakeoverDto) {
  const date = (value?: string | null) =>
    value ? new Date(`${value}T00:00:00Z`) : null;
  return {
    providerType: dto.providerType ?? null,
    providerName: dto.providerName?.trim() ?? null,
    projectName: dto.projectName?.trim() ?? null,
    sellerAmount: dto.sellerAmount ?? null,
    remainingBalance: dto.remainingBalance ?? null,
    balanceAsOf: date(dto.balanceAsOf),
    paymentAmount: dto.paymentAmount ?? null,
    paymentFrequency: dto.paymentFrequency ?? null,
    remainingMonths: dto.remainingMonths ?? null,
    nextPaymentDate: date(dto.nextPaymentDate),
    interestType: dto.interestType ?? null,
    annualInterestRate: dto.annualInterestRate ?? null,
    transferStatus: dto.transferStatus ?? null,
    transferFee: dto.transferFee ?? null,
    transferFeePayer: dto.transferFeePayer ?? null,
    arrearsAmount: dto.arrearsAmount ?? null,
    arrearsPayer: dto.arrearsPayer ?? null,
    hasAdditionalPayments: dto.hasAdditionalPayments ?? null,
    notes: dto.notes?.trim() ?? null,
  };
}

export function additionalPaymentRows(dto: TakeoverDto) {
  return (dto.additionalPayments ?? []).map((payment, order) => ({
    amount: payment.amount ?? null,
    dueDate: payment.dueDate ? new Date(`${payment.dueDate}T00:00:00Z`) : null,
    order,
  }));
}
