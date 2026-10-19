// House Rules: about half of all raids come with a twist, announced as you drop in. Party raids
// pick theirs from the shared map seed, so everyone in the squad plays by the same rule without
// another message on the wire.

export const RULES = {
  lowgrav: { name: 'Low Gravity', icon: '🌙', desc: 'Everything floats. Jump higher, fall slower, throw farther.', gravity: 0.6, jump: 1.05 },
  glass: { name: 'Glass Cannon', icon: '💥', desc: 'Every hit lands 50% harder. Yours and theirs.', dmg: 1.5 },
  jackpot: { name: 'Jackpot Night', icon: '🎰', desc: 'Every crate holds extra loot. The machines are tougher for it.', lootRolls: 1, machineHp: 1.3 },
  heads: { name: 'Headhunter', icon: '🎯', desc: 'Weak-spot hits do double their usual damage.', crit: 2 },
  bounty: { name: 'Double Bounty', icon: '💰', desc: 'Two raiders have a price on their heads tonight.', bounties: 2 },
};

// What the physics reads every step. Reset to normal whenever a raid starts without a rule.
export const live = { gravity: 1, jump: 1 };

// Half the time nothing; otherwise one of the rules, evenly.
export function rollRule(seed = null) {
  let r = Math.random();
  if (seed !== null) {
    // A quick hash of the seed, so the rule doesn't line up with the map's own rolls.
    let h = (seed ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const ids = Object.keys(RULES);
  if (r < 0.5) return null;
  return ids[Math.min(ids.length - 1, Math.floor(((r - 0.5) / 0.5) * ids.length))];
}

export function applyRule(id) {
  const rule = id ? RULES[id] : null;
  live.gravity = (rule && rule.gravity) || 1;
  live.jump = (rule && rule.jump) || 1;
  return rule;
}
