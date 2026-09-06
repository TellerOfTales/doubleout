import { describe, expect, it } from 'vitest';
import { simulate, seedRange } from '../src/core/bot.ts';
describe('balance probe', () => {
  it('probe', () => {
    const t = (label: string, fn: () => any) => { const s = Date.now(); const r = fn(); console.log(label, 'ms', Date.now()-s, JSON.stringify({win: r.winRate, legs: +r.meanLegsWon.toFixed(2), busts: +r.meanBusts.toFixed(2), c: r.legWinRatesConditional.map((x:number)=>+x.toFixed(2)), reached: r.legReached, m180: r.median180s, staked: +r.meanPotStaked.toFixed(1), won: +r.meanPotWon.toFixed(1)})); return r; };
    t('naive full  ', () => simulate(seedRange(40), 'naive'));
    t('optimal full', () => simulate(seedRange(20), 'optimal'));
    t('naive leg1  ', () => simulate(seedRange(40), 'naive', { shop: false }));
    t('opt leg8 bare', () => simulate(seedRange(20), 'optimal', { startLeg: 7, shop: false }));
    t('opt leg8 chalk', () => simulate(seedRange(20), 'optimal', { startLeg: 7, shop: false, startChalk: ['heavy_tips','hot_twenty','fourth_dart','straight_out','wide_grip'] }));
    expect(true).toBe(true);
  }, 600000);
});
