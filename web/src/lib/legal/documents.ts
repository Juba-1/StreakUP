export type LegalDocId = 'terms' | 'privacy'

export type LegalSection = {
  title: string
  paragraphs: string[]
  bullets?: string[]
}

export type LegalDocument = {
  title: string
  updated: string
  intro: string
  sections: LegalSection[]
}

const UPDATED = 'May 2026'

export const LEGAL_DOCUMENTS: Record<LegalDocId, { en: LegalDocument; ar: LegalDocument }> = {
  terms: {
    en: {
      title: 'Terms of Service',
      updated: UPDATED,
      intro:
        'These Terms govern your use of the StreakUp loyalty and streak-tracking platform. By using StreakUp you agree to these Terms.',
      sections: [
        {
          title: '1. SaaS platform only',
          paragraphs: [
            'StreakUp provides software-as-a-service tools for streak tracking, customer engagement, and reward milestone management.',
            'StreakUp is not a café, retailer, or reward issuer. We do not sell coffee, goods, or promotional items.',
          ],
        },
        {
          title: '2. Café owner responsibility',
          paragraphs: [
            'Each café or brand using StreakUp (“Café Owner”) is solely responsible for:',
          ],
          bullets: [
            'Defining, funding, and fulfilling all physical rewards and promotions shown in their program.',
            'Honouring redemptions at the point of sale and training staff accordingly.',
            'Compliance with local consumer-protection, tax, and advertising laws.',
            'Any disputes with end customers regarding rewards, refunds, or service quality.',
          ],
        },
        {
          title: '3. Zero platform liability for rewards',
          paragraphs: [
            'StreakUp expressly disclaims all liability for unfulfilled, delayed, incorrect, or disputed rewards.',
            'Any claim relating to a reward must be directed to the relevant Café Owner, not StreakUp.',
            'StreakUp’s maximum aggregate liability for any claim arising from use of the platform is limited to the fees paid to StreakUp by the Café Owner in the twelve (12) months preceding the claim, or SAR 500, whichever is lower.',
          ],
        },
        {
          title: '4. Acceptable use',
          paragraphs: [
            'Users must not abuse streak mechanics, commit fraud, share accounts, or attempt to circumvent program rules.',
            'We may suspend access for abuse, security risk, or non-payment by a Café Owner.',
          ],
        },
        {
          title: '5. Changes',
          paragraphs: [
            'We may update these Terms. Material changes will be reflected on this page. Continued use after publication constitutes acceptance.',
          ],
        },
      ],
    },
    ar: {
      title: 'شروط الاستخدام',
      updated: UPDATED,
      intro:
        'تحكم هذه الشروط استخدامك لمنصة ستريك أب لتتبع السلاسل وبرامج الولاء. باستخدامك للمنصة فإنك توافق على هذه الشروط.',
      sections: [
        {
          title: '1. مزود برمجيات فقط',
          paragraphs: [
            'تقدّم ستريك أب خدمة برمجية (SaaS) لإدارة السلاسل والتفاعل مع العملاء ومعالم المكافآت.',
            'ستريك أب ليست مقهىً أو بائع تجزئة ولا تصدر المكافآت المادية بنفسها.',
          ],
        },
        {
          title: '2. مسؤولية مالك المقهى',
          paragraphs: ['كل مقهى أو علامة تستخدم ستريك أب («مالك المقهى») مسؤول وحده عن:'],
          bullets: [
            'تعريف وتمويل وتنفيذ جميع المكافآت والعروض الظاهرة في برنامجه.',
            'استبدال المكافآت عند نقطة البيع وتدريب الموظفين.',
            'الامتثال لأنظمة حماية المستهلك والضرائب والإعلانات المحلية.',
            'أي نزاع مع العملاء بخصوص المكافآت أو الاسترداد أو جودة الخدمة.',
          ],
        },
        {
          title: '3. إعفاء المنصة من مسؤولية المكافآت',
          paragraphs: [
            'تُخلي ستريك أب مسؤوليتها صراحةً عن أي مكافأة لم تُنفَّذ أو تأخرت أو كانت خاطئة أو متنازع عليها.',
            'أي مطالبة متعلقة بمكافأة يجب توجيهها إلى مالك المقهى المعني، وليس إلى ستريك أب.',
            'الحد الأقصى لمسؤولية ستريك أب تجاه أي مطالبة ناشئة عن استخدام المنصة هو أقلّ من: رسوم الاشتراك المدفوعة لستريك أب خلال الاثني عشر (12) شهراً السابقة، أو 500 ريال سعودي.',
          ],
        },
        {
          title: '4. الاستخدام المقبول',
          paragraphs: [
            'يحظر إساءة استخدام آليات السلسلة أو الاحتيال أو مشاركة الحسابات أو التحايل على القواعد.',
            'يجوز لنا تعليق الوصول عند إساءة الاستخدام أو مخاطر أمنية أو عدم السداد من قِبل مالك المقهى.',
          ],
        },
        {
          title: '5. التعديلات',
          paragraphs: [
            'يجوز تحديث هذه الشروط. يُعد استمرار الاستخدام بعد النشر موافقةً على النسخة المحدّثة.',
          ],
        },
      ],
    },
  },
  privacy: {
    en: {
      title: 'Privacy Policy',
      updated: UPDATED,
      intro:
        'This Policy explains how StreakUp collects and uses personal data in line with Saudi PDPL principles and good privacy practice.',
      sections: [
        {
          title: '1. Data we collect',
          paragraphs: ['We collect only what is needed to operate the service:'],
          bullets: [
            'Mobile phone numbers — for customer identification and OTP-style portal access.',
            'Display names — optional, for a personalised experience.',
            'Visit and streak data — check-ins, shields, and reward milestone status.',
            'Staff account emails — for HQ, branch, and cashier authentication via Supabase Auth.',
          ],
        },
        {
          title: '2. How we use data',
          paragraphs: [
            'Data is used strictly for authentication, streak calculation, reward eligibility, and café analytics dashboards.',
            'We do not sell, rent, or trade personal data to third parties for marketing.',
          ],
        },
        {
          title: '3. Sharing',
          paragraphs: [
            'Café Owners can see their own customers’ data within their workspace.',
            'Infrastructure providers (e.g. hosting, database) process data under contract and only as needed to run the platform.',
          ],
        },
        {
          title: '4. Retention & deletion',
          paragraphs: [
            'We retain data while an account or customer profile is active and as required by law.',
            'You may request deletion of your personal data by contacting the café you enrolled with or StreakUp support at 0557217757. We will delete or anonymise within a reasonable period unless law requires retention.',
          ],
        },
        {
          title: '5. Security',
          paragraphs: [
            'We apply industry-standard technical and organisational measures including encrypted transport, access controls, and row-level security in our database.',
          ],
        },
        {
          title: '6. Contact',
          paragraphs: [
            'For privacy requests: StreakUp — phone 0557217757 (Saudi Arabia).',
          ],
        },
      ],
    },
    ar: {
      title: 'سياسة الخصوصية',
      updated: UPDATED,
      intro:
        'توضّح هذه السياسة كيف تجمع ستريك أب البيانات الشخصية وتستخدمها بما يتوافق مع مبادئ نظام حماية البيانات الشخصية (PDPL) في المملكة.',
      sections: [
        {
          title: '1. البيانات التي نجمعها',
          paragraphs: ['نجمع فقط ما يلزم لتشغيل الخدمة:'],
          bullets: [
            'أرقام الجوال — لتحديد العملاء والدخول إلى البوابة.',
            'الأسماء الظاهرة — اختياري لتجربة مخصصة.',
            'بيانات الزيارات والسلاسل — تسجيل الحضور والدروع وحالة المكافآت.',
            'بريد موظفي المقهى — لمصادقة HQ والفروع والكاشير.',
          ],
        },
        {
          title: '2. كيف نستخدم البيانات',
          paragraphs: [
            'تُستخدم البيانات حصرياً للمصادقة وحساب السلسلة وأهلية المكافآت ولوحات التحليلات للمقهى.',
            'لا نبيع أو نؤجر البيانات الشخصية لأطراف ثالثة لأغراض تسويقية.',
          ],
        },
        {
          title: '3. المشاركة',
          paragraphs: [
            'يرى مالك المقهى بيانات عملائه فقط ضمن مساحة عمله.',
            'مزودو البنية التحتية (الاستضافة وقواعد البيانات) يعالجون البيانات بموجب عقد وللضرورة التشغيلية فقط.',
          ],
        },
        {
          title: '4. الاحتفاظ والحذف',
          paragraphs: [
            'نحتفظ بالبيانات طالما الحساب أو ملف العميل نشطاً أو كما يقتضي النظام.',
            'يمكنك طلب حذف بياناتك عبر المقهى المسجّل لديه أو دعم ستريك أب على 0557217757. سنحذف أو نُجهّل البيانات خلال مدة معقولة ما لم يمنع النظام ذلك.',
          ],
        },
        {
          title: '5. الأمان',
          paragraphs: [
            'نطبّق إجراءات تقنية وتنظيمية معيارية تشمل التشفير أثناء النقل وضوابط الوصول وأمان الصفوف في قاعدة البيانات.',
          ],
        },
        {
          title: '6. التواصل',
          paragraphs: ['لطلبات الخصوصية: ستريك أب — هاتف 0557217757 (المملكة العربية السعودية).'],
        },
      ],
    },
  },
}
