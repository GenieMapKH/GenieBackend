import { CallsController } from './calls.controller';

describe('TURN issuance budget', () => {
  it('charges the authenticated account and never issues credentials after exhaustion', async () => {
    const consume = jest.fn().mockResolvedValue(undefined);
    const create = jest.fn().mockReturnValue({ consume });
    const forUser = jest.fn().mockResolvedValue({ iceServers: [] });
    const controller = new CallsController(
      { forUser } as never,
      {} as never,
      { create } as never,
    );
    expect(create).toHaveBeenCalledWith('turn-credentials', 30, 3600);
    await expect(controller.getIceServers('alice')).resolves.toEqual({
      iceServers: [],
    });
    expect(consume).toHaveBeenCalledWith('alice');
    forUser.mockClear();
    consume.mockRejectedValueOnce(new Error('exhausted'));
    await expect(controller.getIceServers('alice')).rejects.toMatchObject({
      status: 429,
    });
    expect(forUser).not.toHaveBeenCalled();
  });
});
