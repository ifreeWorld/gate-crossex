import type Database from 'better-sqlite3';
import { Decimal } from 'decimal.js';
import { DEFAULT_GOLD_ALERT_SETTINGS, GoldAlertSettingsSchema, type GoldAlertSettings, type GoldQuote } from '@gate-crossex/shared-types';

const PREFIX = 'gold:';
const MAX_GAP_MS = 10000;
type Episode = { since: number | null; last: number | null; recovery: number | null; alerted: boolean };
type Send = (title: string, body: string) => Promise<'sent' | 'failed' | 'unknown'>;

/** 后台分别监控买 A 卖 B、买 B 卖 A 的可成交毛价差；前端筛选和观察窗口不影响告警。 */
export class GoldAlerts {
  settings: GoldAlertSettings;
  private episodes = new Map<string, Episode>();
  private pending = new Set<Promise<unknown>>();
  constructor(private db: Database.Database, private send: Send, private configured: () => boolean) {
    const stored = db.prepare('SELECT payload FROM observation_settings WHERE id=1').get() as {payload:string} | undefined;
    let input: unknown;
    try { input = stored ? JSON.parse(stored.payload).goldSettings : undefined; } catch { input = undefined; }
    const parsed = GoldAlertSettingsSchema.safeParse(input);
    this.settings = parsed.success ? parsed.data : {...DEFAULT_GOLD_ALERT_SETTINGS};
    for (const row of db.prepare("SELECT direction_id FROM observation_episodes WHERE direction_id LIKE 'gold:%' AND alerted=1").all() as {direction_id: string}[]) {
      this.episodes.set(row.direction_id, { since: null, last: null, recovery: null, alerted: true });
    }
  }
  save(input: GoldAlertSettings) {
    const next = GoldAlertSettingsSchema.parse(input);
    if (next.notificationsEnabled && !this.configured()) throw new Error('bark_not_configured');
    const stored = this.db.prepare('SELECT payload FROM observation_settings WHERE id=1').get() as {payload:string} | undefined;
    let payload: Record<string,unknown> = {};
    try { payload = stored ? JSON.parse(stored.payload) : {}; } catch { /* 恢复默认配置 */ }
    const changed = JSON.stringify(next) !== JSON.stringify(this.settings);
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO observation_settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify({...payload,goldSettings:next}));
      if (changed) this.db.prepare("DELETE FROM observation_episodes WHERE direction_id LIKE 'gold:%'").run();
    })();
    if (changed) this.episodes.clear();
    this.settings = next;
  }
  async stop() { await Promise.allSettled([...this.pending]); }
  check(quotes: GoldQuote[], now: number) {
    const markets = quotes.filter(g => g.market.category === 'gold' && g.market.product === 'perpetual' && g.market.quote === 'USDT')
      .sort((a, b) => a.market.id.localeCompare(b.market.id));
    const active = new Set<string>();
    for (let i = 0; i < markets.length; i++) for (let j = 0; j < markets.length; j++) {
      const a = markets[i], b = markets[j];
      if (a.market.venue === b.market.venue) continue;
      const key = `${PREFIX}${JSON.stringify([a.market.id, b.market.id])}`;
      active.add(key);
      const ready = (g: GoldQuote) => g.ready && !g.market.error && g.normalizedAt !== null
        && g.normalizedAt <= now && now - g.normalizedAt <= MAX_GAP_MS
        && g.bid !== null && g.ask !== null && new Decimal(g.bid).gt(0)
        && new Decimal(g.ask).gte(g.bid);
      if (!ready(a) || !ready(b) || Math.abs(a.normalizedAt! - b.normalizedAt!) > MAX_GAP_MS) {
        this.interrupt(key); continue;
      }
      const spread = new Decimal(a.bid!).div(b.ask!).minus(1).mul(10000);
      const sampledAt = Math.min(a.normalizedAt!, b.normalizedAt!);
      const episode = this.episodes.get(key) ?? { since: null, last: null, recovery: null, alerted: false };
      if (episode.last !== null && sampledAt <= episode.last) continue;
      if (episode.last === null || sampledAt - episode.last > MAX_GAP_MS) {
        episode.since = null;
        episode.recovery = null;
      }
      episode.last = sampledAt;
      this.episodes.set(key, episode);
      if (episode.alerted) {
        if (spread.lt(this.settings.recoveryBps)) {
          episode.recovery ??= sampledAt;
          if (sampledAt - episode.recovery >= this.settings.recoverySeconds * 1000) {
            this.db.prepare('DELETE FROM observation_episodes WHERE direction_id=?').run(key);
            this.episodes.delete(key);
          }
        } else episode.recovery = null;
        continue;
      }
      if (spread.lte(this.settings.thresholdBps)) { this.episodes.delete(key); continue; }
      episode.since ??= sampledAt;
      if (sampledAt - episode.since < this.settings.durationSeconds * 1000) continue;
      episode.alerted = true;
      const message = `黄金跨所价差：卖出 ${a.market.venue} ${a.market.nativeSymbol} / 买入 ${b.market.venue} ${b.market.nativeSymbol}；${a.market.base === b.market.base ? '同标的' : '跨黄金标的'}，可成交毛价差 ${spread.toFixed(2)} bps，连续${this.settings.durationSeconds}秒大于${this.settings.thresholdBps} bps（${this.settings.thresholdBps / 100}%）。卖出买一 ${a.bid} / 买入卖一 ${b.ask}；未扣手续费、资金费和滑点。`;
      const notify = this.settings.notificationsEnabled && this.configured();
      const id = this.db.transaction(() => {
        this.db.prepare('INSERT INTO observation_episodes VALUES (?,1) ON CONFLICT(direction_id) DO UPDATE SET alerted=1').run(key);
        return Number(this.db.prepare('INSERT INTO observation_events(direction_id,message,created_at,status) VALUES (?,?,?,?)').run(key, message, now, notify ? 'pending' : 'recorded').lastInsertRowid);
      })();
      if (notify) {
        const task = Promise.resolve().then(() => this.send(`黄金价差超过${this.settings.thresholdBps} bps`, message)).catch(() => 'unknown' as const)
          .then(status => { this.db.prepare('UPDATE observation_events SET status=? WHERE id=?').run(status, id); });
        this.pending.add(task);
        void task.finally(() => this.pending.delete(task));
      }
    }
    for (const key of this.episodes.keys()) if (!active.has(key)) this.interrupt(key);
  }
  private interrupt(key: string) {
    const episode = this.episodes.get(key);
    if (episode) { episode.since = null; episode.last = null; episode.recovery = null; }
  }
}
