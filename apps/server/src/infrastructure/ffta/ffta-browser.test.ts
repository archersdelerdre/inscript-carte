import { expect, test } from 'bun:test';

import { isAllowedUrl } from './ffta-browser.ts';

test('lets Chrome reach the FFTA site, all its subdomains, and the Cloudflare check', () => {
  for (const url of [
    'https://ffta.fr/',
    'https://www.ffta.fr/competitions?page=3',
    'https://extranet.ffta.fr/medias/documents_epreuves/1.pdf',
    'https://WWW.FFTA.FR./epreuve/1',
    'https://challenges.cloudflare.com/turnstile/v0/api.js',
    'data:image/png;base64,AAAA',
    'about:blank',
  ]) {
    expect(isAllowedUrl(url)).toBe(true);
  }
});

test('refuses look-alike hosts, other sites, plain http and broken URLs', () => {
  for (const url of [
    'https://evilffta.fr/',
    'https://ffta.fr.evil.com/',
    'https://www.ffta.fr@evil.com/',
    'https://cloudflare.com/',
    'https://www.google-analytics.com/collect',
    'http://www.ffta.fr/',
    'ftp://ffta.fr/',
    'not a url',
  ]) {
    expect(isAllowedUrl(url)).toBe(false);
  }
});
