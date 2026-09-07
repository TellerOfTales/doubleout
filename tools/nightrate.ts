/**
 * A fast night-win-rate probe, for tuning the visit-limit ladder.
 *
 * `tools/balance.ts` is the real thing and takes minutes, mostly in the
 * twenty-chalk-set sweep. When the only question is "is a night the right
 * difficulty", this answers it in seconds.
 *
 *   npx vite-node tools/nightrate.ts [--n=N] [--limits]
 */
import { seedRange, simulate } from '../src/core/bot';
import { LEGS } from '../src/content/legs';

const n = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) ?? 40);
const r = simulate(seedRange(n), 'optimal');
const pc = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`${n} nights, optimal`);
console.log(`  night win rate      ${pc(r.winRate).padStart(5)}   target 18-28%`);
console.log(`  mean legs won       ${r.meanLegsWon.toFixed(2).padStart(5)}`);
console.log(`  busts per night     ${r.meanBusts.toFixed(1).padStart(5)}   target 3-7`);
console.log(`  Pot staked / won    ${r.meanPotStaked.toFixed(0)} / ${r.meanPotWon.toFixed(0)}`);
// A bust is no longer the only thing that wipes a slate, so counting busts
// alone understates how often the room goes quiet. A dart off the board does
// it too, and with free aim that is the commoner of the two.
const wiped = r.outcomes.reduce((a, o) => a + (o.slatesWiped ?? 0), 0) / r.outcomes.length;
console.log(`  slates wiped/night  ${wiped.toFixed(1).padStart(5)}`);
console.log(`  legs (conditional)  ${r.legWinRatesConditional.map(pc).join(' ')}`);
console.log(`  visit limits        ${LEGS.map((l) => l.visitLimit).join(' ')}`);
