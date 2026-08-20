/**
 * The Parsedle answer pool.
 *
 * Every entry is one logged boss kill performance ("a parse"). The player is
 * the thing you are guessing; the rest of the row is the evidence you get to
 * reason from.
 *
 * Names and guilds here are fictional. Swap this file for real data pulled
 * from the Warcraft Logs API (see README) — the shape is all the game needs.
 */

/** @typedef {'dps'|'healer'|'tank'} Role */
/** @typedef {'LFR'|'Normal'|'Heroic'|'Mythic'} Difficulty */

/**
 * @typedef {Object} Parse
 * @property {string} id           Stable id, also the share/permalink key.
 * @property {string} player       Character name (the answer).
 * @property {string} class        WoW class.
 * @property {string} spec         Specialisation.
 * @property {Role} role
 * @property {string} region       EU / NA / KR / CN / TW / OCE.
 * @property {string} guild
 * @property {string} raid
 * @property {string} boss
 * @property {Difficulty} difficulty
 * @property {number} percentile   Best-parse percentile, 0-100.
 * @property {number} ilvl         Average item level on the pull.
 * @property {number} amount       DPS or HPS, whichever the role is scored on.
 * @property {number} durationSec  Length of the pull.
 */

/** @type {Parse[]} */
export const PARSES = [
  { id: 'p001', player: 'Thalvira',   class: 'Priest',       spec: 'Shadow',        role: 'dps',    region: 'EU', guild: 'Whispers of Ash',   raid: 'Manaforge Omega',       boss: 'Dimensius',                difficulty: 'Mythic', percentile: 99, ilvl: 691, amount: 1842000, durationSec: 604 },
  { id: 'p002', player: 'Brokktar',   class: 'Warrior',      spec: 'Fury',          role: 'dps',    region: 'NA', guild: 'Vault Wardens',     raid: 'Manaforge Omega',       boss: 'Nexus-King Salhadaar',     difficulty: 'Mythic', percentile: 96, ilvl: 688, amount: 1755000, durationSec: 512 },
  { id: 'p003', player: 'Sunweaver',  class: 'Paladin',      spec: 'Holy',          role: 'healer', region: 'EU', guild: 'Whispers of Ash',   raid: 'Manaforge Omega',       boss: 'Fractillus',               difficulty: 'Heroic', percentile: 88, ilvl: 672, amount: 912000,  durationSec: 288 },
  { id: 'p004', player: 'Nyxaris',    class: 'Demon Hunter', spec: 'Havoc',         role: 'dps',    region: 'KR', guild: 'Silent Ledger',     raid: 'Manaforge Omega',       boss: 'Loom’ithar',          difficulty: 'Mythic', percentile: 93, ilvl: 684, amount: 1620000, durationSec: 431 },
  { id: 'p005', player: 'Grimhollow', class: 'Death Knight', spec: 'Blood',         role: 'tank',   region: 'NA', guild: 'Vault Wardens',     raid: 'Manaforge Omega',       boss: 'Plexus Sentinel',          difficulty: 'Mythic', percentile: 74, ilvl: 686, amount: 988000,  durationSec: 367 },
  { id: 'p006', player: 'Emberlyn',   class: 'Mage',         spec: 'Fire',          role: 'dps',    region: 'EU', guild: 'Nine Circles',      raid: 'Manaforge Omega',       boss: 'Forgeweaver Araz',         difficulty: 'Mythic', percentile: 100, ilvl: 690, amount: 1913000, durationSec: 398 },
  { id: 'p007', player: 'Kaelmoor',   class: 'Evoker',       spec: 'Augmentation',  role: 'dps',    region: 'NA', guild: 'Nine Circles',      raid: 'Manaforge Omega',       boss: 'The Soul Hunters',         difficulty: 'Heroic', percentile: 81, ilvl: 668, amount: 742000,  durationSec: 344 },
  { id: 'p008', player: 'Ravenspire', class: 'Rogue',        spec: 'Subtlety',      role: 'dps',    region: 'OCE', guild: 'Dawnbreakers',     raid: 'Manaforge Omega',       boss: 'Soulbinder Naazindhri',    difficulty: 'Mythic', percentile: 91, ilvl: 683, amount: 1588000, durationSec: 456 },
  { id: 'p009', player: 'Mirethorn',  class: 'Druid',        spec: 'Restoration',   role: 'healer', region: 'EU', guild: 'Dawnbreakers',      raid: 'Manaforge Omega',       boss: 'Dimensius',                difficulty: 'Mythic', percentile: 97, ilvl: 687, amount: 1044000, durationSec: 621 },
  { id: 'p010', player: 'Volgrim',    class: 'Shaman',       spec: 'Enhancement',   role: 'dps',    region: 'NA', guild: 'Iron Covenant',     raid: 'Liberation of Undermine', boss: 'Chrome King Gallywix',   difficulty: 'Mythic', percentile: 85, ilvl: 661, amount: 1402000, durationSec: 588 },
  { id: 'p011', player: 'Ashenveil',  class: 'Warlock',      spec: 'Destruction',   role: 'dps',    region: 'EU', guild: 'Iron Covenant',     raid: 'Liberation of Undermine', boss: 'Mug’Zee',           difficulty: 'Mythic', percentile: 78, ilvl: 658, amount: 1298000, durationSec: 502 },
  { id: 'p012', player: 'Sylenne',    class: 'Monk',         spec: 'Mistweaver',    role: 'healer', region: 'TW', guild: 'Jade Lantern',      raid: 'Liberation of Undermine', boss: 'One-Armed Bandit',       difficulty: 'Heroic', percentile: 94, ilvl: 645, amount: 868000,  durationSec: 376 },
  { id: 'p013', player: 'Durnholde',  class: 'Paladin',      spec: 'Protection',    role: 'tank',   region: 'NA', guild: 'Iron Covenant',     raid: 'Liberation of Undermine', boss: 'Sprocketmonger Lockenstock', difficulty: 'Mythic', percentile: 69, ilvl: 660, amount: 812000, durationSec: 412 },
  { id: 'p014', player: 'Quillfen',   class: 'Hunter',       spec: 'Marksmanship',  role: 'dps',    region: 'EU', guild: 'Nine Circles',      raid: 'Liberation of Undermine', boss: 'Stix Bunkjunker',        difficulty: 'Mythic', percentile: 89, ilvl: 657, amount: 1355000, durationSec: 349 },
  { id: 'p015', player: 'Torvald',    class: 'Death Knight', spec: 'Unholy',        role: 'dps',    region: 'KR', guild: 'Silent Ledger',     raid: 'Liberation of Undermine', boss: 'Rik Reverb',             difficulty: 'Mythic', percentile: 98, ilvl: 663, amount: 1476000, durationSec: 391 },
  { id: 'p016', player: 'Isolde',     class: 'Priest',       spec: 'Discipline',    role: 'healer', region: 'EU', guild: 'Whispers of Ash',   raid: 'Liberation of Undermine', boss: 'Cauldron of Carnage',    difficulty: 'Heroic', percentile: 72, ilvl: 640, amount: 704000,  durationSec: 305 },
  { id: 'p017', player: 'Brannoch',   class: 'Warrior',      spec: 'Protection',    role: 'tank',   region: 'OCE', guild: 'Dawnbreakers',     raid: 'Liberation of Undermine', boss: 'Vexie and the Geargrinders', difficulty: 'Normal', percentile: 55, ilvl: 628, amount: 641000, durationSec: 284 },
  { id: 'p018', player: 'Ysolde',     class: 'Evoker',       spec: 'Preservation',  role: 'healer', region: 'NA', guild: 'Vault Wardens',     raid: 'Liberation of Undermine', boss: 'Chrome King Gallywix',   difficulty: 'Heroic', percentile: 86, ilvl: 649, amount: 921000,  durationSec: 555 },
  { id: 'p019', player: 'Fenrisk',    class: 'Druid',        spec: 'Feral',         role: 'dps',    region: 'EU', guild: 'Moonlit Vigil',     raid: 'Nerub-ar Palace',       boss: 'Queen Ansurek',            difficulty: 'Mythic', percentile: 95, ilvl: 639, amount: 1188000, durationSec: 578 },
  { id: 'p020', player: 'Selvaria',   class: 'Mage',         spec: 'Arcane',        role: 'dps',    region: 'KR', guild: 'Silent Ledger',     raid: 'Nerub-ar Palace',       boss: 'The Silken Court',         difficulty: 'Mythic', percentile: 92, ilvl: 636, amount: 1147000, durationSec: 464 },
  { id: 'p021', player: 'Orvath',     class: 'Monk',         spec: 'Brewmaster',    role: 'tank',   region: 'EU', guild: 'Moonlit Vigil',     raid: 'Nerub-ar Palace',       boss: 'Nexus-Princess Ky’veza', difficulty: 'Mythic', percentile: 64, ilvl: 634, amount: 702000, durationSec: 322 },
  { id: 'p022', player: 'Wrenlow',    class: 'Rogue',        spec: 'Outlaw',        role: 'dps',    region: 'NA', guild: 'Gilded Anchor',     raid: 'Nerub-ar Palace',       boss: 'Broodtwister Ovi’nax', difficulty: 'Heroic', percentile: 79, ilvl: 621, amount: 942000, durationSec: 419 },
  { id: 'p023', player: 'Halbrecht',  class: 'Shaman',       spec: 'Restoration',   role: 'healer', region: 'EU', guild: 'Moonlit Vigil',     raid: 'Nerub-ar Palace',       boss: 'Rasha’nan',           difficulty: 'Mythic', percentile: 90, ilvl: 637, amount: 838000,  durationSec: 401 },
  { id: 'p024', player: 'Nikoletta',  class: 'Hunter',       spec: 'Beast Mastery', role: 'dps',    region: 'TW', guild: 'Jade Lantern',      raid: 'Nerub-ar Palace',       boss: 'Sikran',                   difficulty: 'Heroic', percentile: 83, ilvl: 618, amount: 905000,  durationSec: 358 },
  { id: 'p025', player: 'Corvinus',   class: 'Warlock',      spec: 'Affliction',    role: 'dps',    region: 'NA', guild: 'Gilded Anchor',     raid: 'Nerub-ar Palace',       boss: 'The Bloodbound Horror',    difficulty: 'Mythic', percentile: 87, ilvl: 633, amount: 1096000, durationSec: 487 },
  { id: 'p026', player: 'Palewind',   class: 'Priest',       spec: 'Holy',          role: 'healer', region: 'OCE', guild: 'Dawnbreakers',     raid: 'Nerub-ar Palace',       boss: 'Ulgrax the Devourer',      difficulty: 'Normal', percentile: 61, ilvl: 608, amount: 612000,  durationSec: 296 },
  { id: 'p027', player: 'Zaeltrix',   class: 'Demon Hunter', spec: 'Vengeance',     role: 'tank',   region: 'CN', guild: 'Crimson Meridian',  raid: 'Manaforge Omega',       boss: 'Nexus-King Salhadaar',     difficulty: 'Mythic', percentile: 82, ilvl: 685, amount: 1021000, durationSec: 518 },
  { id: 'p028', player: 'Marrowvale', class: 'Death Knight', spec: 'Frost',         role: 'dps',    region: 'CN', guild: 'Crimson Meridian',  raid: 'Manaforge Omega',       boss: 'Plexus Sentinel',          difficulty: 'Heroic', percentile: 67, ilvl: 665, amount: 1204000, durationSec: 362 },
  { id: 'p029', player: 'Ilyanna',    class: 'Evoker',       spec: 'Devastation',   role: 'dps',    region: 'EU', guild: 'Nine Circles',      raid: 'Manaforge Omega',       boss: 'The Soul Hunters',         difficulty: 'Mythic', percentile: 99, ilvl: 689, amount: 1798000, durationSec: 442 },
  { id: 'p030', player: 'Sturmgild',  class: 'Paladin',      spec: 'Retribution',   role: 'dps',    region: 'NA', guild: 'Gilded Anchor',     raid: 'Liberation of Undermine', boss: 'One-Armed Bandit',       difficulty: 'Mythic', percentile: 76, ilvl: 656, amount: 1311000, durationSec: 473 },
  { id: 'p031', player: 'Vireska',    class: 'Druid',        spec: 'Balance',       role: 'dps',    region: 'EU', guild: 'Moonlit Vigil',     raid: 'Manaforge Omega',       boss: 'Fractillus',               difficulty: 'Mythic', percentile: 94, ilvl: 682, amount: 1673000, durationSec: 279 },
  { id: 'p032', player: 'Kholvar',    class: 'Shaman',       spec: 'Elemental',     role: 'dps',    region: 'KR', guild: 'Silent Ledger',     raid: 'Manaforge Omega',       boss: 'Soulbinder Naazindhri',    difficulty: 'Heroic', percentile: 71, ilvl: 670, amount: 1244000, durationSec: 447 },
  { id: 'p033', player: 'Perrigan',   class: 'Hunter',       spec: 'Survival',      role: 'dps',    region: 'TW', guild: 'Jade Lantern',      raid: 'Manaforge Omega',       boss: 'Loom’ithar',          difficulty: 'Normal', percentile: 58, ilvl: 651, amount: 968000,  durationSec: 388 },
  { id: 'p034', player: 'Aldemaris',  class: 'Mage',         spec: 'Frost',         role: 'dps',    region: 'CN', guild: 'Crimson Meridian',  raid: 'Liberation of Undermine', boss: 'Rik Reverb',             difficulty: 'Heroic', percentile: 84, ilvl: 647, amount: 1157000, durationSec: 384 },
  { id: 'p035', player: 'Brakthorn',  class: 'Warrior',      spec: 'Arms',          role: 'dps',    region: 'OCE', guild: 'Gilded Anchor',    raid: 'Nerub-ar Palace',       boss: 'Queen Ansurek',            difficulty: 'Heroic', percentile: 66, ilvl: 626, amount: 878000,  durationSec: 594 },
  { id: 'p036', player: 'Tessenwyn',  class: 'Monk',         spec: 'Windwalker',    role: 'dps',    region: 'EU', guild: 'Whispers of Ash',   raid: 'Nerub-ar Palace',       boss: 'Broodtwister Ovi’nax', difficulty: 'Mythic', percentile: 88, ilvl: 638, amount: 1132000, durationSec: 425 },
  { id: 'p037', player: 'Draveth',    class: 'Rogue',        spec: 'Assassination', role: 'dps',    region: 'NA', guild: 'Vault Wardens',     raid: 'Liberation of Undermine', boss: 'Cauldron of Carnage',    difficulty: 'Mythic', percentile: 97, ilvl: 662, amount: 1428000, durationSec: 337 },
  { id: 'p038', player: 'Belgrath',   class: 'Warlock',      spec: 'Demonology',    role: 'dps',    region: 'CN', guild: 'Crimson Meridian',  raid: 'Nerub-ar Palace',       boss: 'Sikran',                   difficulty: 'Mythic', percentile: 80, ilvl: 632, amount: 1063000, durationSec: 366 },
  { id: 'p039', player: 'Amberlash',  class: 'Druid',        spec: 'Guardian',      role: 'tank',   region: 'EU', guild: 'Whispers of Ash',   raid: 'Liberation of Undermine', boss: 'Vexie and the Geargrinders', difficulty: 'Heroic', percentile: 63, ilvl: 643, amount: 745000, durationSec: 311 },
  { id: 'p040', player: 'Serrenith',  class: 'Priest',       spec: 'Shadow',        role: 'dps',    region: 'OCE', guild: 'Dawnbreakers',     raid: 'Manaforge Omega',       boss: 'Forgeweaver Araz',         difficulty: 'Heroic', percentile: 77, ilvl: 674, amount: 1279000, durationSec: 403 },
];

export default PARSES;
