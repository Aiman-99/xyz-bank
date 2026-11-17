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
  it('serves the page at / and for page-like paths, never cached', async () => {
    for (const url of ['/', '/some/page']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
    }
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
