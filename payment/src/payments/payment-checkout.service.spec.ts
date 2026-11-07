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
    service = new PaymentCheckoutService(prisma as never, property as never);
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
        amount: 1,
        status: 'Pending',
      },
    });
    expect(property.settle).toHaveBeenCalledWith(LISTING, 'Active');
    expect(result).toEqual({
      transactionId: 'tx-1',
      status: 'Success',
      isSimulation: true,
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

  it('does not report paid when a concurrent settlement stored a failure', async () => {
    transactionTable.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 'Failed' });
    transactionTable.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.initiate(ME, LISTING, 'request-1'),
    ).resolves.toMatchObject({ status: 'Failed' });
  });
});
