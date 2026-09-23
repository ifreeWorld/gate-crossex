import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { SpreadHistoryStore } from './spread-history.js';

const MINUTE = 60000;
const DAY = 86400000;
const key = 'buy~sell@1000';
const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new Database(':memory:'); databases.push(db);
  for (const name of ['0018_spread_monitor', '0019_spread_recovery']) db.exec(readFileSync(new URL(`../../../migrations/${name}.sql`, import.meta.url), 'utf8'));
  const store = new SpreadHistoryStore(db);
  const now = Date.UTC(2026, 8, 20, 12);
  return { db, store, now };
}
function expected(db: Database.Database, now: number, days: number) {
  return db.prepare('SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(samples),0) AS samples FROM spread_history WHERE series_key = ? AND minute >= ?').get(key, Math.ceil((now - days * DAY) / MINUTE) * MINUTE);
}

describe('长窗口滚动历史', () => {
  it('按有效样本加权，窗口可缩小再扩大，不丢失已有历史', () => {
    const { db, store, now } = fixture();
    const insert = db.prepare('INSERT INTO spread_history VALUES (?,?,?,?)');
    insert.run(key, now - 29 * DAY, 40, 2);
    insert.run(key, now - 6 * DAY, 30, 3);
    insert.run(key, now - 2 * DAY, 20, 4);
    insert.run(key, now - MINUTE, 10, 5);
    for (const days of [7, 1, 3, 30, 7]) {
      const h = store.read(key, now, days * DAY);
      expect({ total: h.total, samples: h.samples }).toEqual(expected(db, now, days));
    }
    store.add(key, now, 26, 7 * DAY);
    const before = store.read(key, now, 7 * DAY);
    expect(before.total).toBe(86); expect(before.samples).toBe(13);
    store.read(key, now, DAY);
    expect(store.read(key, now, 7 * DAY).total).toBe(86);
    expect((db.prepare('SELECT COUNT(*) AS n FROM spread_history').get() as { n: number }).n).toBe(5);
  });
  it.each([1, 3, 7, 30])('%i 天窗口逐分钟过期、跨小时和长时间断档均与数据库一致', days => {
    const { db, store, now } = fixture();
    const insert = db.prepare('INSERT INTO spread_history VALUES (?,?,?,?)');
    db.transaction(() => {
      for (let i = -10; i < 180; i++) insert.run(key, now - days * DAY + i * MINUTE, i * 30, 30);
    })();
    store.read(key, now, days * DAY);
    store.add(key, now, 26, days * DAY);
    for (const minutes of [1, 2, 59, 60, 61, 125, days * 1440 + 1]) {
      const time = now + minutes * MINUTE;
      store.flush(time);
      const h = store.read(key, time, days * DAY);
      expect({ total: h.total, samples: h.samples }).toEqual(expected(db, time, days));
    }
  });
  it('重启后继续同一分钟采样，不覆盖或重复已有样本', () => {
    const { db, store, now } = fixture();
    store.add(key, now, 8, 7 * DAY); store.add(key, now + 1000, 12, 7 * DAY);
    store.flush(now + 1000);
    const restarted = new SpreadHistoryStore(db);
    restarted.add(key, now + 2000, 16, 7 * DAY); restarted.flush(now + 2000);
    expect(restarted.read(key, now + 2000, 7 * DAY).total).toBe(36);
    expect(db.prepare('SELECT total, samples FROM spread_history WHERE series_key = ?').get(key)).toEqual({ total: 36, samples: 3 });
  });
  it('清理 30 天前数据前先扣除过期样本，实时缓存不残留旧值', () => {
    const { db, store, now } = fixture();
    db.prepare('INSERT INTO spread_history VALUES (?,?,?,?)').run(key, now - 30 * DAY + 59 * MINUTE, 100, 10);
    store.read(key, now, 30 * DAY);
    const later = now + 60 * MINUTE;
    store.flush(later);
    db.prepare('DELETE FROM spread_history WHERE minute < ?').run(later - 30 * DAY);
    const h = store.read(key, later + 1000, 30 * DAY);
    expect(h.total).toBe(0); expect(h.samples).toBe(0);
  });
});
