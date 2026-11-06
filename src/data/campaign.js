import { t } from '../i18n.js';
// ============================================================
//  campaign.js — the stages ("المراحل"), played in order.
//  Winning a stage opens the next one; progress is kept on the device.
//
//  enemies / allies : the race of each computer kingdom ('human' | 'orc')
//  together         : true = the enemies are allied with each other
//  level            : the enemies' difficulty (allies always play 'normal')
//  res              : your starting resources (1 = normal)
//  seed             : which version of the map
// ============================================================
export const STAGES = [
  { id: 1, name: t('البداية'), story: t('مملكة صغيرة تتحرش بحدودك. ابنِ اقتصادك وجيشك الأول واطردهم.'),
    map: 'green', seed: 11, enemies: ['human'], level: 'easy', res: 1.2, tip: t('ابنِ منازل وثكنة مبكراً.') },
  { id: 2, name: t('غابات الأورك'), story: t('قبيلة أورك خرجت من الغابة الكثيفة. الطرق ضيقة والأشجار كثيرة.'),
    map: 'forest', seed: 23, enemies: ['orc'], level: 'easy', res: 1.1, tip: t('الأورك ينفجرون! احذر من الانتحاريين.') },
  { id: 3, name: t('الشتاء القارس'), story: t('في أرض الثلج يملك عدوك الهضاب. اصعد إليها قبله.'),
    map: 'winter', seed: 37, enemies: ['human'], level: 'normal', res: 1, tip: t('الرماة فوق الهضبة يرمون أبعد.') },
  { id: 4, name: t('النهر الفاصل'), story: t('نهر عريض بينك وبين الأورك، والجسور قليلة. احمِ المعابر.'),
    map: 'river', seed: 41, enemies: ['orc'], level: 'normal', res: 1, tip: t('أبراج عند الجسر توقف الهجمات.') },
  { id: 5, name: t('حليف في الشدة'), story: t('جارك يطلب العون ضد زعيم أورك قوي. قاتلا معاً.'),
    map: 'lakes', seed: 53, allies: ['human'], enemies: ['orc'], level: 'hard', res: 1, tip: t('هاجم نفس العدو الذي يهاجمه حليفك.') },
  { id: 6, name: t('الصحراء القاحلة'), story: t('موارد قليلة وعدو غني. كل قطعة ذهب مهمة.'),
    map: 'waste', seed: 67, enemies: ['human'], level: 'normal', res: 0.6, tip: t('استولِ على مناجم الذهب في الوسط.') },
  { id: 7, name: t('تحالف الأعداء'), story: t('مملكتان تحالفتا ضدك في المرتفعات. لا تدعهما تجتمعان عليك.'),
    map: 'highlands', seed: 71, enemies: ['human', 'orc'], together: true, level: 'normal', res: 1.2, tip: t('اضرب الأضعف أولاً.') },
  { id: 8, name: t('حرب القبائل'), story: t('قبيلتان من الأورك تزحفان. أنت وحليفك آخر خط دفاع.'),
    map: 'forest', seed: 83, allies: ['human'], enemies: ['orc', 'orc'], together: true, level: 'hard', res: 1, tip: t('الرماحون والجدران ينفعون ضد الأورك.') },
  { id: 9, name: t('الحصار'), story: t('ثلاث ممالك تحاصرك في الشتاء. صمد ثم اضرب.'),
    map: 'winter', seed: 97, enemies: ['human', 'orc', 'human'], together: true, level: 'normal', res: 1.4, tip: t('الأسوار والأبراج أولاً، ثم الهجوم.') },
  { id: 10, name: t('معركة الممالك'), story: t('المعركة الأخيرة: ثلاث ممالك قوية متحالفة. من ينتصر يحكم الأرض كلها.'),
    map: 'highlands', seed: 101, enemies: ['orc', 'human', 'orc'], together: true, level: 'hard', res: 1.3, tip: t('استخدم البطل والسحرة والمنجنيق.') },
];

const KEY = 'mk.campaign.v1';

export function progress() {
  try { const p = JSON.parse(localStorage.getItem(KEY)); if (p && Array.isArray(p.done)) return p; } catch (e) { /* no storage */ }
  return { done: [] };
}

export function completeStage(id) {
  const p = progress();
  if (!p.done.includes(id)) p.done.push(id);
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* no storage */ }
}

// a stage is open when it's the first one or the one before it is won
export const unlocked = (id) => id === 1 || progress().done.includes(id - 1);
export const stageById = (id) => STAGES.find(s => s.id === id);
