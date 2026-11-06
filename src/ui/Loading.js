import { t } from '../i18n.js';
// The loading screen (index.html #loading): a real progress bar fed by Phaser's loader,
// what is being loaded right now, and a rotating tip. Also shown briefly while a battle is prepared.
const $ = (id) => document.getElementById(id);

const TIPS = [
  t('نصيحة: ابنِ مخزناً بجانب الغابة أو المنجم، فيقصر طريق العمال ويزيد دخلك.'),
  t('نصيحة: الرماة فوق الهضبة يرمون أبعد ويضربون أقوى.'),
  t('نصيحة: اضغط مرتين على جندي لتختار كل الجنود حوله.'),
  t('نصيحة: الرمّاحون يهزمون الفرسان، والفرسان يطاردون الرماة.'),
  t('نصيحة: اسحب بطاقة المبنى إلى الخريطة لتبنيه مباشرة.'),
  t('نصيحة: النبضة الحمراء على الخريطة المصغرة تعني أن العدو يهاجمك هناك.'),
  t('نصيحة: الهجوم من الخلف يضرّ أكثر بمرة ونصف.'),
  t('نصيحة: إذا اشتد الهجوم على قلعتك اقرع ناقوس الخطر ليحتمي العمال.'),
];

// what the file is, in words a player understands
function what(key) {
  if (/^sfx_/.test(key)) return t('الأصوات');
  if (/keep|houses|barracks|workshops|chapels|tower|well|market|taverns|resources_|walls|construction/.test(key)) return t('المباني');
  if (/worker|swordsman|spearman|axeman|bowman|musketeer|mage|knight|assassin|priest|ballista|arthax|grum|kanji/.test(key)) return t('الجنود والعمال');
  if (/cliff|ground|grass|shore|trees|pines|palms|rocks|cactus|wheat|tumbleweed|winter|dead/.test(key)) return t('الأرض والغابات');
  return t('المؤثرات');
}

class Loading {
  constructor() { this.tipI = Math.floor(Math.random() * TIPS.length); }

  start() {
    const el = $('loading');
    if (!el) return;
    el.classList.remove('hidden', 'done');
    this.tip();
    clearInterval(this.tipT);
    this.tipT = setInterval(() => this.tip(), 2800);
  }

  tip() { const t = $('ld-tip'); if (t) t.textContent = TIPS[this.tipI++ % TIPS.length]; }

  progress(p, key) {
    const pct = Math.round(p * 100);
    $('ld-fill').style.width = pct + '%';
    $('ld-pct').textContent = pct + '%';
    if (key) $('ld-step').textContent = `${t('تحميل')} ${what(key)}…`;
  }

  // fade out, then hand over (to the menu or the game)
  done(then) {
    this.progress(1);
    $('ld-step').textContent = t('جاهز!');
    clearInterval(this.tipT);
    setTimeout(() => {
      $('loading').classList.add('done');
      setTimeout(() => $('loading').classList.add('hidden'), 450);
      then?.();
    }, 250);
  }

  // short "preparing the battle" while the map is built
  battle() {
    this.start();
    this.progress(0.85);
    $('ld-step').textContent = t('تجهيز ساحة المعركة…');
  }
}

export const loading = new Loading();
