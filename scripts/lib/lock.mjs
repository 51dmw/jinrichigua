// Single-instance run lock backed by a file (cron may fire while a previous run is still going).
// Only the instance that actually acquired the lock may release it — otherwise a skipped run
// would delete the lock of the run that is still working.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';

export function createLock(file, staleMs = 60 * 60 * 1000) {
  let held = false;

  function acquire() {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' });
      held = true;
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = Infinity;
      try { age = Date.now() - new Date(JSON.parse(readFileSync(file, 'utf8')).at).getTime(); } catch { /* 锁文件损坏 → 当作过期 */ }
      if (age < staleMs) return false;
      console.warn(`[lock] 发现 ${Math.round(age / 60000)} 分钟前的残留锁，接管`);
      writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      held = true;
      return true;
    }
  }

  function release() {
    if (!held) return; // 没抢到锁的实例不得删锁
    try { if (existsSync(file)) rmSync(file); } catch { /* 释放失败不影响主流程，靠 stale 兜底 */ }
    held = false;
  }

  return { acquire, release, isHeld: () => held };
}
