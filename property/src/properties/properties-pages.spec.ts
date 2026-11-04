import 'reflect-metadata';
import { toPage } from './dto/page.query';
import { PropertiesController } from './properties.controller';

describe('list endpoints', () => {
  const favorites = { all: jest.fn(), page: jest.fn(), ids: jest.fn() };
  const owned = { all: jest.fn(), page: jest.fn(), inArea: jest.fn() };
  const controller = new PropertiesController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    favorites as never,
    owned as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('answer the whole list as before when no page is asked for, so older apps keep working', async () => {
    await controller.getFavorites('u', {});
    await controller.findAll('u', {});

    expect(favorites.all).toHaveBeenCalledWith('u');
    expect(owned.all).toHaveBeenCalledWith('u');
    expect(favorites.page).not.toHaveBeenCalled();
    expect(owned.page).not.toHaveBeenCalled();
  });

  it('answer one page when asked, from the start and most recently saved first by default', async () => {
    await controller.getFavorites('u', { limit: 20 });
    await controller.findAll('u', { limit: 20, offset: 40 });

    expect(favorites.page).toHaveBeenCalledWith('u', {
      limit: 20,
      offset: 0,
      sort: 'saved',
    });
    expect(owned.page).toHaveBeenCalledWith(
      'u',
      { limit: 20, offset: 40 },
      undefined,
    );
  });

  it('pass the statuses of a tab on to the page', async () => {
    await controller.findAll('u', { limit: 20, status: ['Draft', 'Expired'] });

    expect(owned.page).toHaveBeenCalledWith('u', { limit: 20, offset: 0 }, [
      'Draft',
      'Expired',
    ]);
  });
});

describe('toPage', () => {
  it('sends the rows of the page and says where the next one starts', () => {
    expect(toPage([1, 2, 3], 0, 2)).toEqual({ items: [1, 2], nextOffset: 2 });
    expect(toPage([1, 2], 2, 2)).toEqual({ items: [1, 2], nextOffset: null });
    expect(toPage([], 0, 2)).toEqual({ items: [], nextOffset: null });
  });
});
