import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/create-app.js';
import type { Db } from '../src/db/index.js';

// Serving the built frontend needs no database, so a stub is enough here.
const staticDir = mkdtempSync(path.join(tmpdir(), 'xyz-bank-static-'));
mkdirSync(path.join(staticDir, 'assets'));
writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>XYZ Bank</title>');
writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');
const app = createApp({} as Db, { staticDir, rateLimit: false });
afterAll(() => rmSync(staticDir, { recursive: true, force: true }));

describe('serving the frontend', () => {
  it('serves the page at /, /index.html and page-like paths, never cached', async () => {
    for (const url of ['/', '/index.html', '/some/page']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-store');
      // no file-timestamp validators: no Last-Modified, and no size-time ETag
      expect(res.headers['last-modified']).toBeUndefined();
      expect(res.headers.etag ?? '').not.toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    }
  });

  it('never answers the page with 304, even when a browser revalidates an old copy', async () => {
    // What a browser holding a page from an earlier deploy sends.
    const res = await request(app)
      .get('/')
      .set('If-None-Match', 'W/"189-1668f272800"')
      .set('If-Modified-Since', 'Sat, 20 Oct 2018 01:46:40 GMT');
    expect(res.status).toBe(200);
    expect(res.text).toContain('XYZ Bank');
  });

  it('serves existing files', async () => {
    const res = await request(app).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });

  it('returns 404, not the HTML page, for a missing file such as a script from an older deploy', async () => {
    const res = await request(app).get('/assets/index-OLDHASH.js');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
