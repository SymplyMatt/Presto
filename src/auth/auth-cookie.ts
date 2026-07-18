import { Request } from 'express';

export const authCookieName = 'accessToken';

export const extractJwtFromCookie = (request?: Request): string | null => {
  const header = request?.headers.cookie;
  if (!header) {
    return null;
  }
  const cookie = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${authCookieName}=`));
  if (!cookie) {
    return null;
  }
  return decodeURIComponent(cookie.slice(authCookieName.length + 1));
};
