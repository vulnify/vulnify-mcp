/** Matches Vulnify API key material. Defense in depth: logs never include these. */
const KEY_PATTERN = /vln_(?:live|test)_[A-Za-z0-9_-]+/g;

export function redact(value: string): string {
  return value.replace(KEY_PATTERN, 'vln_[redacted]');
}
