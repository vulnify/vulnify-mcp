import { DEFAULT_BASE_URL } from './constants.js';

/** Resolves the Vulnify API origin. Rejects non-HTTP(S) URLs so a key cannot be sent elsewhere by mistake. */
export function resolveBaseUrl(input?: string): string {
  const raw = (input && input.trim() ? input.trim() : DEFAULT_BASE_URL).replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('VULNIFY_BASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('VULNIFY_BASE_URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new Error('VULNIFY_BASE_URL must not include credentials.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path === '' || path === '/' ? '' : path}`;
}
