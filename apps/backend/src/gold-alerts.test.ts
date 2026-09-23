import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoldQuote } from '@gate-crossex/shared-types';
import { GoldAlerts } from './gold-alerts.js';

const dbs: Database.Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function fixture(configured = true) {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../../../migrations/0020_asset_monitor.sql', import.meta.url), 'utf8'));
  dbs.push(db);
  const send = vi.fn(async () => 'sent' as const);
  const create = () => new GoldAlerts(db, send, () => configured);
  const service = create();
  let now = 1800000000000;
  const quote = (id: string, bid: string, ask = bid): GoldQuote => ({
    ready: true, normalizedAt: now, bid, ask, conversion: '原始USDT',
    market: { id, venue: id === 'a' ? 'BINANCE' : 'GATE', nativeSymbol: `${id}_USDT`, base: 'PAXG', quote: 'USDT', product: 'perpetual', category: 'gold', bid, ask, bidSize: '10', askSize: '10', observedAt: now, sourceAt: null, error: null },
  });
  const tick = (price = '100.4', ms = 10000, transform = (q: GoldQuote[]) => q, target = service) => {
    now += ms; target.check(transform([quote('a', price), quote('b', '100')]), now);
  };
  const events = () => db.prepare('SELECT * FROM observation_events ORDER BY id').all() as {message:string; status:string}[];
  return { db, send, service, create, tick, quote, events };
}
describe('黄金双方向告警', () => {
  it.each(['100.4', '99.6'])('正反方向 %s 持续20秒触发，同轮及重启后去重', async price => {
    const f = fixture(); f.tick(price); f.tick(price, 9999); f.tick(price, 9999);
    expect(f.events()).toHaveLength(0); f.tick(price, 2); await f.service.stop();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.events()[0].message).toContain(price === '100.4' ? '卖出 BINANCE a_USDT / 买入 GATE b_USDT' : '卖出 GATE b_USDT / 买入 BINANCE a_USDT');
    expect(f.events()[0].status).toBe('sent');
    const restart = f.create(); for (let i=0;i<4;i++) f.tick(price, 10000, q => q.reverse(), restart);
    await restart.stop(); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('35bps边界不触发，宽盘口不能通过绝对值制造机会', () => {
    const f = fixture(); for(let i=0;i<4;i++) f.tick('100.35'); expect(f.events()).toHaveLength(0);
    for(let i=0;i<4;i++) f.tick('99', 10000, q => q.map(g => ({...g, ask:'101'})));
    expect(f.events()).toHaveLength(0);
  });
  it('不足阈值中断累计；恢复后从零计时', () => {
    const f = fixture(); f.tick(); f.tick(); f.tick('100.35'); f.tick(); f.tick();
    expect(f.events()).toHaveLength(0); f.tick(); expect(f.events()).toHaveLength(1);
  });
  it.each(['错误', '过期', '不同步', '消失', '采样间隔'])('%s中断20秒计时', mode => {
    const f = fixture(); f.tick(); f.tick();
    f.tick('100.4', mode==='采样间隔'?11000:10000, q => {
      if(mode==='错误') q[0].ready=false;
      if(mode==='过期') q.forEach(g => {g.normalizedAt!-=11000;});
      if(mode==='不同步') q[0].normalizedAt!-=11000;
      return mode==='消失'?[]:q;
    });
    f.tick(); expect(f.events()).toHaveLength(0); f.tick();
    if(mode!=='采样间隔') {expect(f.events()).toHaveLength(0);f.tick();}
    expect(f.events()).toHaveLength(1);
  });
  it('重复旧快照不会累计持续时间', () => {
    const f=fixture(), quotes=[f.quote('a','100.4'),f.quote('b','100')];
    for(let i=0;i<5;i++) f.tick('100.4',5000,()=>quotes);
    expect(f.events()).toHaveLength(0);
  });
  it('30bps附近抖动不重新通知，低于30持续20秒才重新布防', async () => {
    const f=fixture(); for(let i=0;i<3;i++) f.tick();
    for(let i=0;i<3;i++) f.tick('100.30');
    for(let i=0;i<3;i++) f.tick(); expect(f.events()).toHaveLength(1);
    f.tick('100.29'); f.tick('100.29'); f.tick('100.30'); f.tick('100.29'); f.tick('100.29');
    for(let i=0;i<3;i++) f.tick(); expect(f.events()).toHaveLength(1);
    for(let i=0;i<3;i++) f.tick('100.29');
    for(let i=0;i<3;i++) f.tick(); await f.service.stop(); expect(f.send).toHaveBeenCalledTimes(2);
  });
  it('未配置Bark只记录；同所组合不触发', () => {
    const f=fixture(false); for(let i=0;i<3;i++) f.tick();
    expect(f.events()[0].status).toBe('recorded'); expect(f.send).not.toHaveBeenCalled();
    const other=fixture(); for(let i=0;i<3;i++) other.tick('100.4',10000,q=>q.map(g=>({...g,market:{...g.market,venue:'GATE'}})));
    expect(other.events()).toHaveLength(0);
  });
  it('发送异常保留未知状态，不在每轮轮询重发', async () => {
    const f=fixture(); f.send.mockRejectedValueOnce(new Error('network'));
    for(let i=0;i<4;i++) f.tick(); await f.service.stop();
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.events()[0].status).toBe('unknown');
  });
});

it('自定义阈值与时间生效、持久化且Bark关闭后仅记录', async () => {
 const f=fixture();
 const settings={thresholdBps:50,durationSeconds:10,recoveryBps:25,recoverySeconds:5,notificationsEnabled:false};
 f.service.save(settings);expect(f.create().settings).toEqual(settings);
 for(let i=0;i<3;i++) f.tick('100.4');expect(f.events()).toHaveLength(0);
 f.tick('100.6');f.tick('100.6',9999);expect(f.events()).toHaveLength(0);f.tick('100.6',1);
 expect(f.events()[0]).toMatchObject({status:'recorded',message:expect.stringContaining('连续10秒大于50 bps')});
 f.tick('100.2');f.tick('100.2',5000);f.tick('100.6');f.tick('100.6');
 expect(f.events()).toHaveLength(2);await f.service.stop();expect(f.send).not.toHaveBeenCalled();
});
it('修改规则重新计时，拒绝无效参数和未配置Bark时开启通知', () => {
 const f=fixture();f.tick();f.tick();
 f.service.save({...f.service.settings,thresholdBps:36});f.tick();f.tick();expect(f.events()).toHaveLength(0);f.tick();expect(f.events()).toHaveLength(1);
 expect(()=>f.service.save({...f.service.settings,recoveryBps:36})).toThrow();
 expect(()=>f.service.save({...f.service.settings,durationSeconds:0})).toThrow();
 const unconfigured=fixture(false);expect(()=>unconfigured.service.save({...unconfigured.service.settings})).toThrow('bark_not_configured');
});
