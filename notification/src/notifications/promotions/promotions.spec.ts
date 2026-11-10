import { ConflictException } from '@nestjs/common';
import { PushContent, PushTarget } from '../delivery/push-sender';
import { PromotionSender } from './promotion-sender';
import { PromotionsService } from './promotions.service';

const UNIQUE = Object.assign(new Error('unique'), { code: 'P2002' });

describe('PromotionsService', () => {
  const promotionTable = { create: jest.fn(), findUnique: jest.fn() };
  const prisma = { promotion: promotionTable };
  const sender = { startInBackground: jest.fn() };
  let promotions: PromotionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    promotions = new PromotionsService(prisma as never, sender as never);
  });

  it('records the promotion and starts sending it', async () => {
    promotionTable.create.mockResolvedValue({ id: 'p1', status: 'queued' });

    const result = await promotions.create('admin', {
      title: 'Sale',
      body: 'Now',
    });

    expect(promotionTable.create.mock.calls[0][0].data).toMatchObject({
      createdBy: 'admin',
      title: 'Sale',
    });
    expect(sender.startInBackground).toHaveBeenCalledWith('p1');
    expect(result.status).toBe('queued');
  });

  it('a repeated request with the same id is not sent twice', async () => {
    promotionTable.create.mockRejectedValue(UNIQUE);
    promotionTable.findUnique.mockResolvedValue({
      id: 'p1',
      status: 'sending',
      createdBy: 'admin',
    });

    const result = await promotions.create('admin', {
      id: 'p1',
      title: 'Sale',
      body: 'Now',
    });

    expect(result).toEqual({ id: 'p1', status: 'sending' });
    expect(sender.startInBackground).not.toHaveBeenCalled();
  });

  it("another admin cannot reuse someone else's id", async () => {
    promotionTable.create.mockRejectedValue(UNIQUE);
    promotionTable.findUnique.mockResolvedValue({
      id: 'p1',
      status: 'sent',
      createdBy: 'other-admin',
    });

    await expect(
      promotions.create('admin', { id: 'p1', title: 'Sale', body: 'Now' }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('PromotionSender', () => {
  const promotionTable = {
    updateMany: jest.fn(),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
  };
  const prisma = { promotion: promotionTable };
  const pages: PushTarget[][] = [];
  const devices = {
    promotionAudience: jest.fn(async function* () {
      for (const page of pages) yield page;
    }),
  };
  const delivered: PushContent[] = [];
  const delivery = {
    deliver: jest.fn(
      (
        targets: PushTarget[],
        contentFor: (t: PushTarget) => PushContent | null,
      ) => {
        targets.forEach((target) => delivered.push(contentFor(target)!));
        return Promise.resolve({
          sent: targets.length - 1,
          failed: 1,
          removed: 0,
        });
      },
    ),
  };
  const device = (id: string): PushTarget => ({
    id,
    token: id,
    platform: 'web',
    locale: 'en',
  });
  const lastUpdate = () =>
    promotionTable.update.mock.calls[
      promotionTable.update.mock.calls.length - 1
    ][0];
  let sender: PromotionSender;

  beforeEach(() => {
    jest.clearAllMocks();
    pages.length = 0;
    delivered.length = 0;
    promotionTable.findUniqueOrThrow.mockResolvedValue({
      id: 'p1',
      title: 'Sale',
      body: 'Now',
      titleKm: null,
      bodyKm: null,
      propertyId: null,
      url: 'https://tilomnov.example/sale',
      imageUrl: null,
    });
    sender = new PromotionSender(
      prisma as never,
      devices as never,
      delivery as never,
    );
  });

  it('sends to every page of the audience and keeps the counts', async () => {
    promotionTable.updateMany.mockResolvedValue({ count: 1 });
    pages.push([device('a'), device('b')], [device('c')]);

    await sender.send('p1');

    expect(delivered).toHaveLength(3);
    expect(delivered[0].data).toEqual({
      type: 'promotion',
      promotionId: 'p1',
      url: 'https://tilomnov.example/sale',
    });
    expect(promotionTable.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { sentCount: 1, failedCount: 2 },
    });
    expect(lastUpdate().data.status).toBe('sent');
  });

  it('a promotion someone already started is not sent again', async () => {
    promotionTable.updateMany.mockResolvedValue({ count: 0 });

    await sender.send('p1');

    expect(promotionTable.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'queued' },
      data: expect.objectContaining({ status: 'sending' }),
    });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('a failure part-way marks it failed', async () => {
    promotionTable.updateMany.mockResolvedValue({ count: 1 });
    pages.push([device('a')]);
    delivery.deliver.mockRejectedValueOnce(new Error('database gone'));

    await expect(sender.send('p1')).rejects.toThrow('database gone');

    expect(lastUpdate().data.status).toBe('failed');
  });
});
