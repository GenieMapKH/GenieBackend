import { BlockChecker, BlockedException } from './block-checker';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

describe('BlockChecker', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  let checker: BlockChecker;

  beforeAll(() => {
    process.env.INTERNAL_SERVICE_SECRET = 'x'.repeat(40);
  });

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as typeof fetch;
    checker = new BlockChecker();
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  const answer = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('asks the user service about the pair, signed as chat', async () => {
    answer({ blocked: true });

    await expect(checker.eitherBlocked(ALICE, BOB)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/internal/blocks/${ALICE}/with/${BOB}$`));
    expect((init.headers as Record<string, string>).authorization).toMatch(
      /^Bearer /,
    );
  });

  it('refuses with a code the app recognises', async () => {
    answer({ blocked: true });

    const refusal = checker.requireNotBlocked(ALICE, BOB);
    await expect(refusal).rejects.toThrow(BlockedException);
    await expect(refusal).rejects.toMatchObject({ code: 'blocked' });
  });

  it('lets a message through when neither has blocked the other', async () => {
    answer({ blocked: false });
    await expect(checker.requireNotBlocked(ALICE, BOB)).resolves.toBe(
      undefined,
    );
  });

  it('keeps chat working when the user service cannot answer', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(checker.eitherBlocked(ALICE, BOB)).resolves.toBe(false);

    answer({ message: 'boom' }, 500);
    await expect(checker.eitherBlocked(ALICE, BOB)).resolves.toBe(false);
  });
});
