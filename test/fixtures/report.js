/**
 * A trimmed-down Warcraft Logs report, shaped like the real GraphQL response:
 * two kills and two wipes, mixed roles, one player who only wiped.
 */

export function makeReport(overrides = {}) {
  return {
    code: 'AbCd1234EfGh5678',
    title: 'Wednesday — Manaforge Omega',
    startTime: 1_755_000_000_000,
    endTime: 1_755_010_000_000,
    zone: { id: 44, name: 'Manaforge Omega' },
    guild: { name: 'Whispers of Ash', server: { region: { compactName: 'EU' } } },
    fights: [
      { id: 1, encounterID: 3129, name: 'Plexus Sentinel', difficulty: 5, kill: false, startTime: 0, endTime: 120000 },
      { id: 2, encounterID: 3129, name: 'Plexus Sentinel', difficulty: 5, kill: false, startTime: 130000, endTime: 250000 },
      { id: 3, encounterID: 3129, name: 'Plexus Sentinel', difficulty: 5, kill: true, startTime: 300000, endTime: 600000 },
      { id: 4, encounterID: 3131, name: 'Soulbinder Naazindhri', difficulty: 4, kill: true, startTime: 700000, endTime: 940000 },
    ],
    rankings: {
      data: [
        {
          fightID: 3,
          kill: 1,
          difficulty: 5,
          duration: 300000,
          encounter: { id: 3129, name: 'Plexus Sentinel' },
          roles: {
            tanks: {
              characters: [
                { id: 11, name: 'Grimhollow', class: 'Death Knight', spec: 'Blood', amount: 988123.4, rankPercent: 74.4, bracketData: 686 },
              ],
            },
            healers: {
              characters: [
                { id: 12, name: 'Sunweaver', class: 'Paladin', spec: 'Holy', amount: 912000.9, rankPercent: 88.2, bracketData: 672 },
              ],
            },
            dps: {
              characters: [
                { id: 13, name: 'Thalvira', class: 'Priest', spec: 'Shadow', amount: 1842000, rankPercent: 98.7, bracketData: 691 },
                { id: 14, name: 'Emberlyn', class: 'Mage', spec: 'Fire', amount: 1500000, rankPercent: 62.1, itemLevel: 690 },
              ],
            },
          },
        },
        {
          fightID: 4,
          kill: 1,
          difficulty: 4,
          duration: 240000,
          encounter: { id: 3131, name: 'Soulbinder Naazindhri' },
          roles: {
            tanks: { characters: [] },
            healers: {
              characters: [
                { id: 12, name: 'Sunweaver', class: 'Paladin', spec: 'Holy', amount: 700000, rankPercent: 41, bracketData: 672 },
              ],
            },
            dps: {
              characters: [
                { id: 13, name: 'Thalvira', class: 'Priest', spec: 'Shadow', amount: 1600000, rankPercent: 99.9, bracketData: 691 },
                // No percentile at all — an unranked row the game must skip.
                { id: 15, name: 'Ghostparse', class: 'Rogue', spec: 'Subtlety', amount: 900000, bracketData: 660 },
              ],
            },
          },
        },
      ],
    },
    ...overrides,
  };
}
