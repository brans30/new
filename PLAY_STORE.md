# النشر على Google Play — خطوة بخطوة

## 1) أضف مفتاح التوقيع إلى GitHub (مرة واحدة)
في المستودع: **Settings ← Secrets and variables ← Actions ← New repository secret**، وأضف 4 أسرار
(القيم في الملف `secrets.txt` الذي أرسلته لك):

| Name | Secret |
|---|---|
| `KEYSTORE_BASE64` | محتوى `KEYSTORE_BASE64.txt` كاملاً |
| `KEYSTORE_PASSWORD` | كلمة السر |
| `KEY_ALIAS` | `minikingdoms` |
| `KEY_PASSWORD` | كلمة السر نفسها |

ثم **Actions ← Android build ← Run workflow**. سيخرج في Artifacts ملفان:
- `mini-kingdoms-test-1.0.X.apk` — للتجربة على هاتفك (إعلانات تجريبية).
- `mini-kingdoms-store-1.0.X.aab` — **للمتجر** (إعلانات حقيقية). لا تحتاج تثبيته.

⚠️ احفظ `mini-kingdoms-upload.jks` و `secrets.txt` في مكان آمن خاص. هذا "مفتاح الرفع":
إذا ضاع يمكن طلب مفتاح جديد من Google لأن التطبيق يستخدم Play App Signing، لكن ذلك يأخذ أياماً.

## 2) حساب المطوّر
https://play.google.com/console — رسوم مرة واحدة (25$). الحسابات الشخصية الجديدة تحتاج اختباراً مغلقاً
مع 12 مختبِراً لمدة 14 يوماً قبل النشر للجميع (مسار **Closed testing**).

## 3) إنشاء التطبيق
**Create app** ← الاسم: الممالك الصغيرة ← لعبة ← مجانية.

## 4) صفحة المتجر
- الأيقونة: `store-icon-512.png`
- صورة العرض 1024×500 وصور الشاشة: اطلبها مني وأجهّزها.
- الوصف القصير والطويل: اطلبهما مني.

## 5) نماذج المحتوى (App content)
- **Privacy policy**: https://github.com/brans30/new/blob/mini-kingdoms/PRIVACY.md
- **Ads**: نعم، التطبيق يحتوي إعلانات.
- **Target audience**: 13 سنة فما فوق (لا تختر فئات الأطفال، وإلا تنطبق قواعد العائلات على الإعلانات).
- **Data safety**:
  - يجمع بيانات؟ نعم (عبر AdMob): **Device or other IDs** (معرّف الإعلانات)، **App interactions**، **Approximate location**.
  - الغرض: Advertising or marketing، Fraud prevention / security، Analytics.
  - مشاركة مع طرف ثالث: نعم (Google AdMob). مشفّرة أثناء النقل: نعم. يمكن طلب الحذف: لا تجمع اللعبة بيانات بنفسها.
- **Content rating**: استبيان IARC — عنف كرتوني خفيف (معارك بشخصيات صغيرة، بلا دم).

## 6) الرفع
**Testing ← Closed testing** (أو Production) ← **Create new release** ← ارفع `mini-kingdoms-store-1.0.X.aab`.
كل بناء جديد رقمه أكبر تلقائياً.

## 7) ربط AdMob بالمتجر
بعد النشر: في AdMob ← Apps ← التطبيق ← **App settings ← Link to app store**. الإعلانات الحقيقية تبدأ بعد مراجعة AdMob (يوم إلى أيام).
- في AdMob ← **Privacy & messaging** أنشئ رسالة **GDPR** (لأوروبا) — اللعبة تعرضها تلقائياً.
- (موصى به) ملف `app-ads.txt` على موقع المطوّر — نضيفه لاحقاً إذا أنشأت موقعاً.
