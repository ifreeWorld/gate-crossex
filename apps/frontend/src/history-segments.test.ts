import { describe, expect, it } from 'vitest';
import { splitHistorySegments } from './history-segments.js';

describe('历史图表连续采样分段', () => {
  const points = [0, 60_000, 120_000, 600_000, 660_000].map(time => ({ time, value: time / 60_000 }));
  it('默认保持海力士与其他历史图连续行为', () => {
    expect(splitHistorySegments(points)).toEqual([points]);
    expect(splitHistorySegments([])).toEqual([]);
  });
  it('黄金主线与均线都不跨越采样空窗，且没有填入伪造点', () => {
    const segments = splitHistorySegments(points, 90_000);
    expect(segments.map(part => part.map(p => p.time))).toEqual([[0, 60_000, 120_000], [600_000, 660_000]]);
    expect(segments.flat()).toEqual(points);
  });
  it('单点与恰好位于连续阈值的记录仍然有效', () => {
    expect(splitHistorySegments(points.slice(0, 1), 60_000)).toEqual([points.slice(0, 1)]);
    expect(splitHistorySegments(points.slice(0, 3), 60_000)).toHaveLength(1);
  });
});
