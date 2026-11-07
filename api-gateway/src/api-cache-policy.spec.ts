import { apiCachePolicy } from './api-cache-policy';

it('prevents shared and browser caches from retaining API answers', () => {
  const setHeader = jest.fn();
  const next = jest.fn();
  apiCachePolicy({} as never, { setHeader } as never, next);
  expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(next).toHaveBeenCalledTimes(1);
});
