import { ServiceUnavailableException } from '@nestjs/common';
import { AccountContentService } from './account-content.service';
import { RemoteAccountContent } from './remote-account-content';

const ME = '11111111-1111-4111-8111-111111111111';

describe('AccountContentService', () => {
  const users = { publicViewChanged: jest.fn() };
  const avatars = { removeAllOf: jest.fn() };
  const properties = {
    eraseFiles: jest.fn(),
    notifyVisibilityChanged: jest.fn(),
  };
  const chat = { eraseFiles: jest.fn(), notifyVisibilityChanged: jest.fn() };
  let content: AccountContentService;

  beforeEach(() => {
    jest.clearAllMocks();
    content = new AccountContentService(
      users as never,
      avatars as never,
      properties as never,
      chat as never,
    );
  });

  it('erases every kind of file an account can upload', async () => {
    await content.eraseFiles(ME);

    expect(properties.eraseFiles).toHaveBeenCalledWith(ME);
    expect(chat.eraseFiles).toHaveBeenCalledWith(ME);
    expect(avatars.removeAllOf).toHaveBeenCalledWith(ME);
  });

  it('does not report success when one kind could not be erased', async () => {
    chat.eraseFiles.mockRejectedValue(
      new Error('the chat service is unreachable'),
    );

    await expect(content.eraseFiles(ME)).rejects.toThrow('chat service');
  });

  it('does not report success when a whole service is down', async () => {
    properties.eraseFiles.mockRejectedValue(new ServiceUnavailableException());

    await expect(content.eraseFiles(ME)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('drops everything cached about an account that was hidden or came back', async () => {
    await content.visibilityChanged(ME);

    expect(users.publicViewChanged).toHaveBeenCalledWith(ME);
    expect(chat.notifyVisibilityChanged).toHaveBeenCalledWith(ME);
  });
});

describe('RemoteAccountContent', () => {
  const fetchMock = jest.fn();
  let remote: RemoteAccountContent;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
    process.env.INTERNAL_SERVICE_SECRET =
      'a-shared-secret-of-at-least-thirty-two-characters';
    remote = new RemoteAccountContent('property', 'http://property.test');
  });

  it('asks the service to erase the files of exactly that account', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await remote.eraseFiles(ME);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://property.test/internal/accounts/${ME}/files`);
    expect(init.method).toBe('DELETE');
    expect(init.headers.authorization).toMatch(/^Bearer /);
  });

  it('fails an erase the service did not confirm', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));

    await expect(remote.eraseFiles(ME)).rejects.toThrow();
  });

  it('never fails a cache notice: the entry expires on its own', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(remote.notifyVisibilityChanged(ME)).resolves.toBeUndefined();
  });
});
