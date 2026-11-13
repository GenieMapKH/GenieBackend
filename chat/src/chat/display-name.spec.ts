import { DISPLAY_FIELDS, displayName } from './display-name';

describe('chat display names', () => {
  it('selects only display columns available to the restricted chat role', () => {
    expect(DISPLAY_FIELDS).toEqual({
      name: true,
      username: true,
      avatarUrl: true,
    });
  });

  it('prefers the chosen name, then username, never recovery contacts', () => {
    const user = {
      name: 'Dara',
      username: 'dara',
      email: 'private@example.test',
      phone: '+85512345678',
    };
    expect(displayName(user)).toBe('Dara');
    expect(displayName({ ...user, name: null })).toBe('dara');
    expect(displayName({ ...user, name: null, username: null })).toBe(
      'Property Owner',
    );
    expect(displayName(null)).toBe('Property Owner');
  });
});
