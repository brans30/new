import { TEAM, TEAMS, KINGDOMS } from '../data/config.js';

// =====================================================================
//  The match being played: which kingdoms take part, who is allied with
//  whom, how hard each computer player is, and where everybody starts.
//
//  kingdoms: [{ color, alliance, difficulty, ai, spot }]
//    alliance  'A' | 'B' | 'C' | 'D', or null = alone (everyone is an enemy)
//    ai        false only for the human player
// =====================================================================
export const MATCH = {
  map: 'green',
  seed: 1,                 // which version of the map (the setup screen can roll a new one)
  player: 'cyan',
  kingdoms: [
    { color: 'cyan', alliance: null, difficulty: 'normal', ai: false, spot: 0 },
    { color: 'red', alliance: null, difficulty: 'normal', ai: true, spot: 1 },
  ],
};

export function setMatch(m) {
  Object.assign(MATCH, m);
  TEAMS.length = 0;
  for (const k of MATCH.kingdoms) TEAMS.push(k.color);
  TEAM.PLAYER = MATCH.player;
}

export const kingdomOf = (team) => MATCH.kingdoms.find(k => k.color === team);
export const nameOf = (team) => KINGDOMS[team]?.name || team;

// same team, or both in the same alliance
export function allied(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const A = kingdomOf(a)?.alliance, B = kingdomOf(b)?.alliance;
  return !!A && A === B;
}
// two kingdoms that fight each other (neutral things like trees are nobody's enemy)
export const hostile = (a, b) => !!a && !!b && !allied(a, b);

// how the player sees another kingdom
export const relation = (team) => team === TEAM.PLAYER ? 'me' : allied(team, TEAM.PLAYER) ? 'ally' : 'enemy';
