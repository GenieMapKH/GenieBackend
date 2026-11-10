import { BadRequestException } from '@nestjs/common';
import { PaymentCheckoutService } from './payment-checkout.service';

const ME = '11111111-1111-4111-8111-111111111111';
const LISTING = '33333333-3333-4333-8333-333333333333';

describe('PaymentCheckoutService', () => {
  const transactionTable = {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
  };
  const prisma = { paymentTransaction: transactionTable };
  const property = { begin: jest.fn(), revert: jest.fn(), settle: jest.fn() };
  const gateway = {
    checkout: jest.fn(async (t) => ({
      transactionId: t.id,
      status: 'Success',
    })),
    reconcile: jest.fn(),
  };
  const provider = { name: 'MOCK' };
  let service: PaymentCheckoutService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_MODE = 'mock';
    process.env.APP_ENV = 'test';
    transactionTable.findUnique.mockResolvedValue(null);
    transactionTable.updateMany.mockResolvedValue({ count: 1 });
    property.begin.mockResolvedValue({ previousStatus: 'Draft' });
    property.revert.mockResolvedValue(undefined);
    transactionTable.create.mockResolvedValue({
      id: 'tx-1',
      status: 'Pending',
    });
    property.settle.mockResolvedValue(undefined);
    service = new PaymentCheckoutService(
      prisma as never,
      property as never,
      gateway as never,
      provider as never,
    );
  });

  it('records a mock transaction and publishes on the server before reporting success', async () => {
    const result = await service.initiate(ME, LISTING, 'aba_khqr');

    expect(property.begin).toHaveBeenCalledWith(ME, LISTING);
    expect(transactionTable.create).toHaveBeenCalledWith({
      data: {
        userId: ME,
        propertyId: LISTING,
        requestId: 'aba_khqr',
        provider: 'MOCK',
        paymentMethod: 'aba_khqr',
        amount: 2,
        status: 'Pending',
      },
    });
    expect(gateway.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tx-1', status: 'Pending' }),
    );
    expect(result).toEqual({
      transactionId: 'tx-1',
      status: 'Success',
    });
  });

  it('starts no payment when the property service refuses (not the owner, wrong status)', async () => {
    property.begin.mockRejectedValue(
      new BadRequestException('Cannot publish a property with status Active'),
    );

    await expect(service.initiate(ME, LISTING, 'aba_khqr')).rejects.toThrow(
      'Cannot publish',
    );
    expect(transactionTable.create).not.toHaveBeenCalled();
  });

  it('gives the listing back its status when the transaction cannot be saved', async () => {
    property.begin.mockResolvedValue({ previousStatus: 'Expired' });
    transactionTable.create.mockRejectedValue(new Error('db down'));

    await expect(service.initiate(ME, LISTING, 'aba_khqr')).rejects.toThrow(
      'db down',
    );

    expect(property.revert).toHaveBeenCalledWith(LISTING, 'Expired');
  });

  it('still reports the original failure when the listing cannot be given back', async () => {
    transactionTable.create.mockRejectedValue(new Error('db down'));
    property.revert.mockRejectedValue(new Error('property down'));

    await expect(service.initiate(ME, LISTING, 'aba_khqr')).rejects.toThrow(
      'db down',
    );
  });

  it('never reveals another account transaction', async () => {
    transactionTable.findFirst.mockResolvedValue(null);
    await expect(service.state(ME, 'someone-else-tx')).rejects.toMatchObject({
      status: 404,
    });
    expect(transactionTable.findFirst).toHaveBeenCalledWith({
      where: { id: 'someone-else-tx', userId: ME },
      select: { id: true, status: true },
    });
  });

  it('polls only an account-owned transaction through provider verification', async () => {
    transactionTable.findFirst.mockResolvedValue({
      id: 'tx-1',
      status: 'Pending',
    });
    gateway.reconcile.mockResolvedValue({
      transactionId: 'tx-1',
      status: 'Pending',
    });
    expect(await service.state(ME, 'tx-1')).toEqual({
      transactionId: 'tx-1',
      status: 'Pending',
    });
    expect(gateway.reconcile).toHaveBeenCalledWith('tx-1');
  });
});
