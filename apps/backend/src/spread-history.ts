import type Database from 'better-sqlite3';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
type Bucket = { minute: number; total: number; samples: number };
type History = {
  total: number; samples: number; first: number; windowMs: number; cutoff: number;
  expiryThrough: number; expiring: Map<number, Bucket>; current: Bucket | null;
  dirty: Map<number, Bucket>; lastUsed: number;
};

// 长窗口只在内存保留总和、即将过期的一小时和待落库的分钟桶，避免每个方向常驻 30 天明细。
export class SpreadHistoryStore {
  private cache = new Map<string, History>();
  constructor(private db: Database.Database) {}

  read(key: string, now: number, windowMs: number): History {
    const cutoff = Math.ceil((now - windowMs) / MINUTE) * MINUTE;
    let h = this.cache.get(key);
    if (h && h.windowMs !== windowMs) {
      this.write(key, h);
      this.cache.delete(key);
      h = undefined;
    }
    if (!h) {
      const totals = this.sum(key, cutoff);
      const start = this.db.prepare('SELECT started_at FROM spread_series WHERE series_key = ?').get(key) as { started_at: number } | undefined;
      const first = this.db.prepare('SELECT MIN(minute) AS minute FROM spread_history WHERE series_key = ? AND minute >= ?').get(key, cutoff) as { minute: number | null };
      const minute = Math.floor(now / MINUTE) * MINUTE;
      const current = this.db.prepare('SELECT minute, total, samples FROM spread_history WHERE series_key = ? AND minute = ?').get(key, minute) as Bucket | undefined;
      const expiryThrough = Math.floor(cutoff / HOUR) * HOUR + HOUR;
      h = { ...totals, first: start?.started_at ?? first.minute ?? Infinity, windowMs, cutoff, expiryThrough, expiring: this.buckets(key, cutoff, expiryThrough), current: current ?? null, dirty: new Map(), lastUsed: now };
      this.cache.set(key, h);
    } else if (cutoff > h.cutoff) {
      if (cutoff < h.expiryThrough) {
        for (const [minute, bucket] of h.expiring) {
          if (minute >= cutoff) break;
          h.total -= bucket.total; h.samples -= bucket.samples; h.expiring.delete(minute);
        }
      } else {
        // 跨小时或进程暂停后，补扣整个过期区间；先落库，保证长时间跳跃也不会漏掉内存样本。
        this.write(key, h);
        const expired = this.sum(key, h.cutoff, cutoff);
        h.total -= expired.total; h.samples -= expired.samples;
        h.expiryThrough = Math.floor(cutoff / HOUR) * HOUR + HOUR;
        h.expiring = this.buckets(key, cutoff, h.expiryThrough);
      }
      h.cutoff = cutoff;
      if (h.samples === 0) h.total = 0;
    }
    h.lastUsed = now;
    return h;
  }

  add(key: string, now: number, value: number, windowMs: number) {
    const h = this.read(key, now, windowMs);
    if (!Number.isFinite(h.first)) {
      h.first = now;
      this.db.prepare('INSERT OR IGNORE INTO spread_series VALUES (?,?)').run(key, now);
    }
    const minute = Math.floor(now / MINUTE) * MINUTE;
    const bucket = h.current?.minute === minute ? h.current : { minute, total: 0, samples: 0 };
    bucket.total += value; bucket.samples++;
    h.total += value; h.samples++; h.current = bucket; h.dirty.set(minute, bucket);
  }

  flush(now: number) {
    this.db.transaction(() => {
      for (const [key, h] of this.cache) {
        const lastUsed = h.lastUsed;
        this.read(key, now, h.windowMs);
        h.lastUsed = lastUsed;
        this.write(key, h);
      }
    })();
    for (const [key, h] of this.cache) if (now - h.lastUsed > 5 * MINUTE) this.cache.delete(key);
  }

  private sum(key: string, from: number, before = Number.MAX_SAFE_INTEGER) {
    return this.db.prepare('SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(samples), 0) AS samples FROM spread_history WHERE series_key = ? AND minute >= ? AND minute < ?').get(key, from, before) as { total: number; samples: number };
  }
  private buckets(key: string, from: number, before: number) {
    const rows = this.db.prepare('SELECT minute, total, samples FROM spread_history WHERE series_key = ? AND minute >= ? AND minute < ? ORDER BY minute').all(key, from, before) as Bucket[];
    return new Map(rows.map(b => [b.minute, b]));
  }
  private write(key: string, h: History) {
    if (!h.dirty.size) return;
    const insert = this.db.prepare('INSERT INTO spread_history VALUES (?,?,?,?) ON CONFLICT(series_key,minute) DO UPDATE SET total=excluded.total,samples=excluded.samples');
    for (const b of h.dirty.values()) insert.run(key, b.minute, b.total, b.samples);
    h.dirty.clear();
  }
}
