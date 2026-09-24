const TOKEN_COOKIE = 'cms_token';

/**
 * Live frontend (zhealth.world) and API (often a separate host) are cross-site.
 * Browsers only send cookies on cross-site XHR when SameSite=None + Secure.
 * Lax works for same-origin / localhost, which is why local multi-tab login works.
 */
function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const sameSiteRaw = String(
    process.env.COOKIE_SAME_SITE || (isProd ? 'none' : 'lax')
  ).toLowerCase();
  const sameSite = ['none', 'lax', 'strict'].includes(sameSiteRaw) ? sameSiteRaw : 'lax';
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.COOKIE_SECURE !== 'false' && (isProd || sameSite === 'none'));
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function setAuthCookie(res, token) {
  res.cookie(TOKEN_COOKIE, token, cookieOptions());
}

export function clearAuthCookie(res) {
  res.clearCookie(TOKEN_COOKIE, { ...cookieOptions(), maxAge: 0 });
}

export function readAuthToken(req) {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  if (req.cookies?.[TOKEN_COOKIE]) {
    return req.cookies[TOKEN_COOKIE];
  }
  return null;
}

export { TOKEN_COOKIE };
