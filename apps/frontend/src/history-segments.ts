/** 对已按时间排序的真实采样分段；空窗不插值，也不跨空窗计算均线。 */
export function splitHistorySegments<T extends { time: number }>(points: T[], gapAfterMs?: number): T[][] {
  const segments: T[][] = [];
  for (const point of points) {
    const current = segments.at(-1);
    if (!current || (gapAfterMs !== undefined && point.time - current.at(-1)!.time > gapAfterMs)) segments.push([point]);
    else current.push(point);
  }
  return segments;
}
