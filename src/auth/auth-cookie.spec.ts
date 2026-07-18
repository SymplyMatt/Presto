import { Request } from 'express';
import { authCookieName, extractJwtFromCookie } from './auth-cookie';

describe('extractJwtFromCookie', () => {
  it('extracts the configured JWT cookie', () => {
    const request = {
      headers: { cookie: `theme=dark; ${authCookieName}=signed.jwt.value` },
    } as Request;

    expect(extractJwtFromCookie(request)).toBe('signed.jwt.value');
  });

  it('returns null when the JWT cookie is absent', () => {
    const request = { headers: { cookie: 'theme=dark' } } as Request;
    expect(extractJwtFromCookie(request)).toBeNull();
  });
});
