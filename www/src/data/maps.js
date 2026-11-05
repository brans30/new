import { t } from '../i18n.js';
// ============================================================
//  maps.js — the maps (themes) you can pick in the setup screen.
//  The layout itself is made by systems/MapBuilder.js from these settings
//  and a seed, mirrored so every kingdom gets the same land.
//
//  ground     tile sheet for the ground (3x2 tiles: plain + tufts)
//  cliff      sheet for plateaus, cliffSet: 'stone' or 'sand' pieces
//  shore      lake colours (sand / ice / oasis)
//  lakes      n lakes in each part of the map, radius range;  midLake: radius of the lake in the middle
//  hills      plateaus in each part of the map
//  trees      which trees grow: mix = [[kind, chance], ...], wet = tree beside water
//  rock       kind of rock
// ============================================================
export const MAPS = {
  green: {
    name: t('الوادي الأخضر'), desc: t('عشب وبحيرات وغابات وهضاب'),
    ground: 'grass', bg: '#8fc45a', mini: { ground: '#9cc95a', tree: '#3d7a2e', rock: '#9a9a92', cliff: '#7d8a6a', top: '#b8d873' },
    cliff: 'cliff', cliffSet: 'stone', shore: 'sand',
    lakes: { n: 2, r: [1.6, 2.4] }, midLake: 2.6, hills: { n: 2 },
    forests: { n: 5, r: [3.0, 4.6] }, forestDensity: 0.85, rocks: { n: 3 }, loneTrees: 0.012,
    trees: { mix: [['tree', 0.75], ['pine', 0.25]], wet: 'palm' }, rock: 'rock',
    decor: 'wheat', horses: true,
  },
  winter: {
    name: t('أرض الشتاء'), desc: t('ثلج وغابات صنوبر وبحيرات متجمدة'),
    ground: 'ground_winter', bg: '#e9f4f5', mini: { ground: '#eef7f8', tree: '#4f8f78', rock: '#b5c2c2', cliff: '#9aa3a0', top: '#ffffff' },
    cliff: 'cliff_winter', cliffSet: 'stone', shore: 'ice',
    lakes: { n: 2, r: [1.5, 2.3] }, midLake: 2.4, hills: { n: 3 },
    forests: { n: 5, r: [3.0, 4.8] }, forestDensity: 0.88, rocks: { n: 3 }, loneTrees: 0.016,
    trees: { mix: [['snowtree', 0.7], ['snowpine', 0.22], ['frostdead', 0.08]] }, rock: 'snowrock',
    decor: null, horses: true,
  },
  waste: {
    name: t('الأراضي القاحلة'), desc: t('صبار وأشجار ميتة وواحات قليلة'),
    ground: 'ground_waste', bg: '#bcb57d', mini: { ground: '#c2b981', tree: '#6d8a3a', rock: '#9e978a', cliff: '#a5733f', top: '#cfc28d' },
    cliff: 'cliff_waste', cliffSet: 'sand', shore: 'oasis',
    lakes: { n: 1, r: [1.3, 1.8] }, midLake: 0, hills: { n: 3 },
    forests: { n: 6, r: [2.4, 3.6] }, forestDensity: 0.62, rocks: { n: 7 }, loneTrees: 0.018,
    trees: { mix: [['cactus', 0.6], ['deadtree', 0.4]], wet: 'palm' }, rock: 'rock', extraGold: true,
    decor: 'tumbleweed', horses: true,
  },
  lakes: {
    name: t('أرض البحيرات'), desc: t('بحيرات كبيرة وجزر وممرات ضيقة'),
    ground: 'grass', bg: '#8fc45a', mini: { ground: '#9cc95a', tree: '#3d7a2e', rock: '#9a9a92', cliff: '#7d8a6a', top: '#b8d873' },
    cliff: 'cliff', cliffSet: 'stone', shore: 'sand',
    lakes: { n: 5, r: [2.2, 3.4] }, midLake: 4.2, hills: { n: 1 }, islands: true,
    forests: { n: 4, r: [2.8, 4.0] }, forestDensity: 0.82, rocks: { n: 3 }, loneTrees: 0.01,
    trees: { mix: [['tree', 0.8], ['pine', 0.2]], wet: 'palm' }, rock: 'rock',
    decor: 'wheat', horses: true,
  },
  river: {
    name: t('وادي النهر'), desc: t('نهر يقسم الخريطة ومخاضات للعبور'),
    ground: 'grass', bg: '#8fc45a', mini: { ground: '#9cc95a', tree: '#3d7a2e', rock: '#9a9a92', cliff: '#7d8a6a', top: '#b8d873' },
    cliff: 'cliff', cliffSet: 'stone', shore: 'sand',
    river: { w: 1.9 }, lakes: { n: 1, r: [1.5, 2.1] }, midLake: 0, hills: { n: 2 },
    forests: { n: 5, r: [2.8, 4.2] }, forestDensity: 0.82, rocks: { n: 3 }, loneTrees: 0.012,
    trees: { mix: [['tree', 0.7], ['pine', 0.3]], wet: 'palm' }, rock: 'rock',
    decor: 'wheat', horses: true,
  },
  forest: {
    name: t('الغابة الكثيفة'), desc: t('أشجار في كل مكان وممرات ضيقة'),
    ground: 'grass', bg: '#7fb44e', mini: { ground: '#94c257', tree: '#2f6a26', rock: '#9a9a92', cliff: '#7d8a6a', top: '#b8d873' },
    cliff: 'cliff', cliffSet: 'stone', shore: 'sand',
    lakes: { n: 1, r: [1.4, 2.0] }, midLake: 2.0, hills: { n: 1 },
    forests: { n: 11, r: [3.2, 5.4] }, forestDensity: 0.92, rocks: { n: 3 }, loneTrees: 0.03,
    trees: { mix: [['tree', 0.55], ['pine', 0.45]], wet: 'palm' }, rock: 'rock',
    decor: null, horses: false,
  },
  highlands: {
    name: t('المرتفعات'), desc: t('هضاب كبيرة كثيرة وصخور وصنوبر'),
    ground: 'grass', bg: '#8fc45a', mini: { ground: '#a2c45e', tree: '#3d7a2e', rock: '#9a9a92', cliff: '#7d8a6a', top: '#c3dc7d' },
    cliff: 'cliff', cliffSet: 'stone', shore: 'sand',
    lakes: { n: 1, r: [1.3, 1.9] }, midLake: 0, hills: { n: 5, size: [6, 10, 4, 7] },
    forests: { n: 4, r: [2.6, 3.8] }, forestDensity: 0.8, rocks: { n: 7 }, loneTrees: 0.012,
    trees: { mix: [['pine', 0.65], ['tree', 0.35]] }, rock: 'rock', extraGold: true,
    decor: null, horses: true,
  },
};
