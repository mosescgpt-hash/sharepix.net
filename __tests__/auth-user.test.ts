import { accountLabel } from '../lib/authUser';

describe('accountLabel', () => {
  it('prefers a first name, then a masked email', () => {
    expect(accountLabel({ given_name: 'Seth', email: 'seth@x.com' })).toBe('Seth');
    expect(accountLabel({ name: 'Seth Calvin' })).toBe('Seth');
    expect(accountLabel({ email: 'seth@sharepix.net' })).toBe('s***@sharepix.net');
    expect(accountLabel({})).toBe('My account');
  });
});
