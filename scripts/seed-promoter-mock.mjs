import process from "node:process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = supabaseUrl?.match(/^https:\/\/([^.]+)\./)?.[1];

if (!projectRef || !accessToken) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const sql = String.raw`
DO $$
#variable_conflict use_variable
DECLARE
  org_record record;
  campaign_id uuid;
  promoter_user_id uuid;
  agent_user_id uuid;
  offer_id uuid;
  lead_names text[] := ARRAY[
    'عبدالله السالم',
    'سارة القحطاني',
    'محمد العتيبي',
    'نورة الحربي',
    'خالد الشهري',
    'ريم الدوسري'
  ];
  lead_index int;
BEGIN
  FOR org_record IN SELECT id, name FROM public.organizations WHERE status ILIKE 'active'
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.promoter_settings
      WHERE organization_id = org_record.id
        AND company_id IS NULL
    ) THEN
      INSERT INTO public.promoter_settings (
        organization_id,
        company_id,
        weights,
        consent_version,
        consent_text_ar,
        consent_text_en
      )
      VALUES (
        org_record.id,
        null,
        '{"savings":0.6,"data":0.2,"bundle":0.1,"priority":0.1}'::jsonb,
        'v1',
        'أوافق على تسجيل بياناتي لغرض ترشيح العرض المناسب والتواصل بخصوص الطلب.',
        'I consent to storing my data to recommend a suitable offer and follow up on this request.'
      );
    END IF;

    UPDATE public.promoter_settings
    SET
      weights = '{"savings":0.6,"data":0.2,"bundle":0.1,"priority":0.1}'::jsonb,
      consent_text_ar = 'أوافق على تسجيل بياناتي لغرض ترشيح العرض المناسب والتواصل بخصوص الطلب.',
      consent_text_en = 'I consent to storing my data to recommend a suitable offer and follow up on this request.',
      updated_at = now()
    WHERE organization_id = org_record.id
      AND company_id IS NULL;

    INSERT INTO public.promoter_reference_values (organization_id, kind, code, label_ar, label_en, sort_order)
    VALUES
      (org_record.id, 'mobile_operator', 'stc', 'stc', 'stc', 1),
      (org_record.id, 'mobile_operator', 'mobily', 'موبايلي', 'Mobily', 2),
      (org_record.id, 'mobile_operator', 'zain', 'زين', 'Zain', 3),
      (org_record.id, 'mobile_operator', 'virgin', 'فيرجن', 'Virgin', 4),
      (org_record.id, 'internet_provider', 'stc-home', 'stc منزلي', 'stc Home', 1),
      (org_record.id, 'internet_provider', 'mobily-fiber', 'موبايلي فايبر', 'Mobily Fiber', 2),
      (org_record.id, 'internet_provider', 'zain-5g', 'زين 5G', 'Zain 5G', 3),
      (org_record.id, 'city', 'riyadh', 'الرياض', 'Riyadh', 1),
      (org_record.id, 'city', 'jeddah', 'جدة', 'Jeddah', 2),
      (org_record.id, 'city', 'dammam', 'الدمام', 'Dammam', 3),
      (org_record.id, 'city', 'khobar', 'الخبر', 'Khobar', 4)
    ON CONFLICT (organization_id, kind, code) DO UPDATE SET
      label_ar = excluded.label_ar,
      label_en = excluded.label_en,
      sort_order = excluded.sort_order,
      is_active = true,
      updated_at = now();

    IF NOT EXISTS (
      SELECT 1
      FROM public.promoter_campaigns
      WHERE organization_id = org_record.id
        AND code = 'PROMO-QA'
    ) THEN
      INSERT INTO public.promoter_campaigns (organization_id, name, code, start_date, end_date, target_leads, is_active)
      VALUES (org_record.id, 'حملة الترويج الربع سنوية', 'PROMO-QA', current_date, current_date + 45, 120, true);
    END IF;

    SELECT id INTO campaign_id
    FROM public.promoter_campaigns
    WHERE organization_id = org_record.id AND code = 'PROMO-QA'
    ORDER BY created_at
    LIMIT 1;

    SELECT p.user_id INTO promoter_user_id
    FROM public.profiles p
    JOIN public.org_members m ON m.user_id = p.user_id AND m.org_id = org_record.id
    WHERE p.org_id = org_record.id
      AND m.role::text IN ('promoter', 'sales', 'sales_manager', 'admin', 'hr_admin')
    ORDER BY CASE m.role::text WHEN 'promoter' THEN 1 WHEN 'sales' THEN 2 ELSE 3 END, p.created_at
    LIMIT 1;

    SELECT p.user_id INTO agent_user_id
    FROM public.profiles p
    JOIN public.org_members m ON m.user_id = p.user_id AND m.org_id = org_record.id
    WHERE p.org_id = org_record.id
      AND m.role::text IN ('sales', 'sales_manager')
    ORDER BY CASE m.role::text WHEN 'sales' THEN 1 ELSE 2 END, p.created_at
    LIMIT 1;

    IF promoter_user_id IS NULL THEN
      SELECT user_id INTO promoter_user_id
      FROM public.profiles
      WHERE org_id = org_record.id
      ORDER BY created_at
      LIMIT 1;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.telecom_offers
      WHERE organization_id = org_record.id
        AND name_en = 'Mobile Saver 120'
    ) THEN
      INSERT INTO public.telecom_offers (
        organization_id,
        name_ar,
        name_en,
        offer_target,
        monthly_price,
        contract_months,
        data_gb,
        minutes,
        sim_count,
        benefits_ar,
        benefits_en,
        eligibility,
        priority,
        is_active,
        created_by
      )
      VALUES
        (org_record.id, 'باقة توفير الجوال 120', 'Mobile Saver 120', 'mobile', 120, 12, 80, 1500, 1, '["بيانات 80GB","مكالمات محلية","مناسبة للإنفاق المتوسط"]'::jsonb, '["80GB data","Local calls","Mid-spend fit"]'::jsonb, '{"target_operators":["mobily","zain","virgin"],"min_monthly_spend":150,"max_monthly_spend":350,"cities":["riyadh","jeddah","dammam","khobar"]}'::jsonb, 20, true, promoter_user_id),
        (org_record.id, 'باقة عائلية متعددة الشرائح', 'Family Multi SIM', 'bundle', 260, 12, 300, 3000, 3, '["3 شرائح","إنترنت منزلي وجوال","أولوية للعائلات"]'::jsonb, '["3 SIMs","Home and mobile bundle","Family fit"]'::jsonb, '{"min_sims":2,"requires_home_internet":true,"min_monthly_spend":250,"cities":["riyadh","jeddah"]}'::jsonb, 35, true, promoter_user_id),
        (org_record.id, 'إنترنت منزلي 5G', 'Home 5G', 'home_internet', 180, 12, 500, null, null, '["راوتر منزلي","بيانات عالية","تركيب سريع"]'::jsonb, '["Home router","High data","Fast setup"]'::jsonb, '{"requires_home_internet":true,"min_monthly_spend":180,"cities":["riyadh","dammam","khobar"]}'::jsonb, 15, true, promoter_user_id),
        (org_record.id, 'إضافة بيانات 50GB', '50GB Add-on', 'addon', 55, 1, 50, null, null, '["إضافة مرنة","بدون التزام طويل"]'::jsonb, '["Flexible add-on","No long commitment"]'::jsonb, '{"min_monthly_spend":80}'::jsonb, 5, true, promoter_user_id);
    END IF;

    IF promoter_user_id IS NOT NULL THEN
      FOR lead_index IN 1..array_length(lead_names, 1)
      LOOP
        SELECT id INTO offer_id
        FROM public.telecom_offers
        WHERE organization_id = org_record.id
          AND is_active = true
        ORDER BY priority DESC, created_at
        OFFSET ((lead_index - 1) % 4)
        LIMIT 1;

        IF NOT EXISTS (
          SELECT 1
          FROM public.promoter_leads
          WHERE organization_id = org_record.id
            AND mobile = '+96650000' || lead_index::text
        ) THEN
          INSERT INTO public.promoter_leads (
            organization_id,
            campaign_id,
            promoter_id,
            full_name,
            mobile,
            city,
            current_operator,
            sim_count,
            monthly_mobile_spend,
            home_internet_provider,
            monthly_home_spend,
            recommended_offer_id,
            estimated_savings,
            recommendation_source,
            recommendation_snapshot,
            status,
            assigned_agent_id,
            consent_given,
            marketing_consent,
            consent_version,
            consent_at,
            language
          )
          VALUES (
            org_record.id,
            campaign_id,
            promoter_user_id,
            lead_names[lead_index],
            '+96650000' || lead_index::text,
            CASE WHEN lead_index % 3 = 0 THEN 'dammam' WHEN lead_index % 2 = 0 THEN 'jeddah' ELSE 'riyadh' END,
            CASE WHEN lead_index % 3 = 0 THEN 'zain' WHEN lead_index % 2 = 0 THEN 'mobily' ELSE 'stc' END,
            1 + (lead_index % 3),
            120 + (lead_index * 30),
            CASE WHEN lead_index % 2 = 0 THEN 'stc-home' ELSE null END,
            CASE WHEN lead_index % 2 = 0 THEN 180 ELSE null END,
            offer_id,
            25 + lead_index * 10,
            'auto',
            jsonb_build_object('seeded', true, 'offer_id', offer_id),
            CASE WHEN lead_index % 5 = 0 THEN 'converted' WHEN lead_index % 2 = 0 THEN 'sent_to_agent' ELSE 'recommended' END,
            CASE WHEN lead_index % 2 = 0 THEN agent_user_id ELSE null END,
            true,
            lead_index % 2 = 0,
            'v1',
            now(),
            'ar'
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

SELECT
  o.name AS organization,
  (SELECT count(*) FROM public.promoter_reference_values r WHERE r.organization_id = o.id)::int AS reference_values,
  (SELECT count(*) FROM public.telecom_offers f WHERE f.organization_id = o.id)::int AS offers,
  (SELECT count(*) FROM public.promoter_campaigns c WHERE c.organization_id = o.id)::int AS campaigns,
  (SELECT count(*) FROM public.promoter_leads l WHERE l.organization_id = o.id)::int AS leads
FROM public.organizations o
WHERE EXISTS (
  SELECT 1
  FROM public.promoter_reference_values r
  WHERE r.organization_id = o.id
)
ORDER BY o.name;
`;

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

const text = await response.text();
if (!response.ok) {
  console.error(`Promoter seed failed (${response.status}): ${text}`);
  process.exit(1);
}

const payload = JSON.parse(text);
console.log("Promoter mock seed completed.");
console.table(Array.isArray(payload) ? payload : payload.result || payload);
