// node --test scripts/lib/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnvFile } from '../env.mjs';
import { createLock } from '../lock.mjs';
import { parseJSON, llmJSON } from '../llm.mjs';
import { render, normalizePunct, bigramJaccard, stripUnsupportedMarkup, TABLE_RE, scanSensitive } from '../text.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'lib-test-'));

test('loadEnvFile: reads values, skips comments/empty, never overwrites existing env', () => {
  const dir = tmp();
  const f = join(dir, '.env');
  writeFileSync(f, '# c\nLIBTEST_A=1\nLIBTEST_B=\nLIBTEST_C = spaced \nLIBTEST_KEEP=new\n');
  process.env.LIBTEST_KEEP = 'old';
  loadEnvFile(f);
  assert.equal(process.env.LIBTEST_A, '1');
  assert.equal(process.env.LIBTEST_B, undefined);
  assert.equal(process.env.LIBTEST_C, 'spaced');
  assert.equal(process.env.LIBTEST_KEEP, 'old');
  assert.throws(() => loadEnvFile(join(dir, 'nope')), /缺少/);
});

test('createLock: second acquire fails, non-holder cannot release, holder releases', () => {
  const f = join(tmp(), '.run.lock');
  const a = createLock(f);
  const b = createLock(f);
  assert.equal(a.acquire(), true);
  assert.equal(b.acquire(), false);
  b.release(); // must not delete a's lock
  assert.equal(existsSync(f), true);
  a.release();
  assert.equal(existsSync(f), false);
});

test('createLock: stale or corrupt lock is taken over', () => {
  const f = join(tmp(), '.run.lock');
  writeFileSync(f, JSON.stringify({ pid: 1, at: new Date(Date.now() - 2 * 3600e3).toISOString() }));
  const l = createLock(f, 3600e3);
  assert.equal(l.acquire(), true);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).pid, process.pid);
  l.release();
  writeFileSync(f, 'not json');
  const l2 = createLock(f, 3600e3);
  assert.equal(l2.acquire(), true);
  l2.release();
});

test('parseJSON: tolerates fences and chatter, picks first array/object, rejects non-JSON', () => {
  assert.deepEqual(parseJSON('好的：\n```json\n{"a":1}\n```', 't'), { a: 1 });
  assert.deepEqual(parseJSON('x [1,2] y', 't'), [1, 2]);
  assert.deepEqual(parseJSON('{"list":[1]}', 't'), { list: [1] });
  assert.throws(() => parseJSON('没有 JSON', 't'), /不含 JSON/);
});

test('llmJSON: repairs bad JSON once, retries on failure, aborts on rate limit', async () => {
  const quiet = console.warn; console.warn = () => {};
  try {
    let n = 0;
    const repaired = await llmJSON(async () => (++n === 1 ? '{"a": "未转义"引号"}' : '{"a":"ok"}'), 'p', 't');
    assert.deepEqual(repaired, { a: 'ok' });
    assert.equal(n, 2);

    let m = 0;
    const retried = await llmJSON(async () => { if (++m < 3) throw new Error('boom'); return '[1]'; }, 'p', 't');
    assert.deepEqual(retried, [1]);

    let r = 0;
    await assert.rejects(llmJSON(async () => { r++; throw new Error('429 Too Many Requests'); }, 'p', 't'), /RATE_LIMIT/);
    assert.equal(r, 1);

    await assert.rejects(llmJSON(async () => { throw new Error('down'); }, 'p', 't'), /down/);
  } finally { console.warn = quiet; }
});

test('text helpers', () => {
  assert.equal(render('{{a}}-{{b}}-{{a}}', { a: 'x' }), 'x--x');
  assert.equal(normalizePunct('你好,世界;今天:晴!真的?'), '你好，世界；今天：晴！真的？');
  assert.equal(normalizePunct('a, b; c: d'), 'a, b; c: d');
  assert.equal(bigramJaccard('', 'abc'), 0);
  assert.equal(bigramJaccard('孙颖莎晋级', '孙颖莎晋级'), 1);
  assert.equal(stripUnsupportedMarkup('a\n---\n> q\n```js\ncode\n```'), 'a\nq\ncode');
  assert.equal(TABLE_RE.test('| a | b |'), true);
  assert.deepEqual(scanSensitive(['BadWord', '', 'x'], { title: 'has badword', content: '' }), ['BadWord']);
});
