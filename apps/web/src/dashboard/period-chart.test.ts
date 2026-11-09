import { describe, expect, it } from 'vitest';

import { hourTicks } from '@/dashboard/period-chart';

describe('hourTicks', () => {
  it('usa horas cheias e no máximo 5 intervalos', () => {
    expect(hourTicks(0)).toEqual([0, 60]);
    expect(hourTicks(200)).toEqual([0, 60, 120, 180, 240]);
    expect(hourTicks(62 * 60 + 57)).toEqual([0, 1200, 2400, 3600, 4800]);
    expect(hourTicks(62 * 60 + 57).at(-1)).toBeGreaterThanOrEqual(62 * 60 + 57);
  });
});
