import { UploadBudgets } from './upload-budgets';

describe('durable upload issuance budget', () => {
  const prisma = { $queryRaw: jest.fn() };
  const budgets = new UploadBudgets(prisma as never);
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ issued_count: 1 }]);
  });
  it('charges worst-case bucket bytes in one conditional database upsert', async () => {
    await budgets.take('user', 'property', 30);
    const [sql, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(sql.join('?')).toContain('ON CONFLICT');
    expect(sql.join('?')).toContain('WHERE upload_budgets.issued_count');
    expect(values).toContain(30 * 8 * 1024 * 1024);
  });
  it.each([0, -1, 1.5, NaN, 121])(
    'never signs or queries for invalid batches: %s',
    async (count) => {
      await expect(
        budgets.take('user', 'property', count),
      ).rejects.toMatchObject({ status: 429 });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    },
  );
  it('fails closed on exhausted budgets and database failures', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(budgets.take('user', 'avatar')).rejects.toMatchObject({
      status: 429,
    });
    prisma.$queryRaw.mockRejectedValue(new Error('database offline'));
    await expect(budgets.take('user', 'attachment')).rejects.toThrow(
      'database offline',
    );
  });
});
