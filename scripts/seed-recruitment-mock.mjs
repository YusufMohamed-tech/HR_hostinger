import crypto from "node:crypto";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const orgSlug = process.env.INITIAL_ORG_SLUG || "tatwir-talent";
const jobCount = Number(process.env.SEED_RECRUITMENT_JOBS || 100);
const applicationCount = Number(process.env.SEED_RECRUITMENT_APPLICATIONS || 5000);

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let seedState = 20260611;
function random() {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}

function pick(list) {
  return list[Math.floor(random() * list.length)];
}

function pickMany(list, min, max) {
  const shuffled = [...list].sort(() => random() - 0.5);
  const count = min + Math.floor(random() * (max - min + 1));
  return shuffled.slice(0, count);
}

function chunk(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function randInt(min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function phoneFor(index) {
  return `+9665${String(31000000 + index).padStart(8, "0")}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const cities = [
  "Riyadh",
  "Jeddah",
  "Dammam",
  "Khobar",
  "Makkah",
  "Madinah",
  "Abha",
  "Tabuk",
  "Qassim",
  "Hail",
  "Jazan",
  "Najran",
  "Taif",
  "Al Ahsa",
];

const sources = ["career_page", "linkedin", "bayt", "referral", "whatsapp", "indeed", "walk_in", "agency"];
const noticePeriods = ["Immediately", "1 week", "2 weeks", "30 days", "60 days"];
const educationLevels = ["High School", "Diploma", "Bachelor", "Master", "Professional Certificate"];
const employmentTypes = ["full_time", "part_time", "contract", "temporary"];
const experienceLevels = ["entry", "junior", "mid", "senior", "lead"];

const jobFamilies = [
  {
    department: "Sales",
    titles: [
      "Sales Representative",
      "Telecom Sales Agent",
      "Retail Sales Specialist",
      "Key Account Executive",
      "Sales Supervisor",
      "Field Sales Coordinator",
      "Sales Operations Specialist",
      "Customer Acquisition Officer",
    ],
    skills: ["Sales", "CRM", "Customer Service", "POS", "Arabic", "Negotiation", "Telecom Products", "Reporting"],
    requirements: [
      "Previous experience in retail or telecom sales.",
      "Strong communication skills in Arabic and basic English.",
      "Ability to work on field targets and daily reporting.",
    ],
  },
  {
    department: "Human Resources",
    titles: [
      "HR Specialist",
      "Recruitment Specialist",
      "Payroll Officer",
      "Personnel Coordinator",
      "Training Coordinator",
      "Employee Relations Officer",
    ],
    skills: ["HR Operations", "Recruitment", "Payroll", "Excel", "Labor Law", "Onboarding", "ATS", "Documentation"],
    requirements: [
      "Experience in HR operations or recruitment workflows.",
      "Good knowledge of Saudi labor regulations.",
      "Strong follow-up and documentation skills.",
    ],
  },
  {
    department: "Operations",
    titles: [
      "Operations Coordinator",
      "Field Supervisor",
      "Branch Manager",
      "Quality Assurance Officer",
      "Logistics Coordinator",
      "Project Coordinator",
    ],
    skills: ["Operations", "Scheduling", "Team Supervision", "Quality Control", "Excel", "Reporting", "Problem Solving"],
    requirements: [
      "Ability to coordinate multi-city field teams.",
      "Experience with operational reporting and service quality follow-up.",
      "Comfortable with daily targets and escalation handling.",
    ],
  },
  {
    department: "Finance",
    titles: [
      "Accountant",
      "Accounts Payable Officer",
      "Payroll Accountant",
      "Financial Analyst",
      "Billing Coordinator",
      "Collection Officer",
    ],
    skills: ["Accounting", "Excel", "ERP", "Reconciliation", "VAT", "Financial Reporting", "Payroll"],
    requirements: [
      "Strong accounting fundamentals and spreadsheet skills.",
      "Experience with reconciliations, invoices, and payment follow-up.",
      "Attention to detail and deadline discipline.",
    ],
  },
  {
    department: "Technology",
    titles: [
      "Frontend Developer",
      "Backend Developer",
      "Full Stack Developer",
      "QA Engineer",
      "Mobile Developer",
      "IT Support Specialist",
      "Data Analyst",
      "Systems Administrator",
    ],
    skills: ["JavaScript", "React", "TypeScript", "SQL", "API", "Testing", "Troubleshooting", "Data Analysis"],
    requirements: [
      "Hands-on experience with production software systems.",
      "Ability to troubleshoot, document, and work with cross-functional teams.",
      "Strong ownership and clear technical communication.",
    ],
  },
];

const maleFirstNames = [
  "Mohammed",
  "Ahmed",
  "Abdullah",
  "Fahad",
  "Khalid",
  "Saud",
  "Nasser",
  "Sultan",
  "Yousef",
  "Omar",
  "Ali",
  "Hassan",
  "Ibrahim",
  "Majed",
  "Turki",
  "Bandar",
  "Rakan",
  "Faisal",
  "Salman",
  "Bader",
  "Mishal",
  "Nawaf",
  "Abdulaziz",
  "Mansour",
];

const femaleFirstNames = [
  "Sara",
  "Noura",
  "Reem",
  "Hanan",
  "Maha",
  "Lama",
  "Abeer",
  "Dalia",
  "Fatimah",
  "Mariam",
  "Hessa",
  "Raghad",
  "Shahad",
  "Joud",
  "Dana",
  "Rana",
  "Amal",
  "Latifah",
  "Nouf",
  "Aisha",
];

const lastNames = [
  "Alharbi",
  "Alqahtani",
  "Alotaibi",
  "Almutairi",
  "Alshammari",
  "Aldosari",
  "Alghamdi",
  "Alzahrani",
  "Alsubaie",
  "Alenazi",
  "Alrashed",
  "Alfahad",
  "Almalki",
  "Alnasser",
  "Alharthi",
  "Alshehri",
  "Alamri",
  "Aljohani",
  "Alotaibi",
  "Alrashidi",
];

const portfolioDomains = ["behance.net", "github.com", "linkedin.com/in", "notion.site", "dribbble.com"];

const stageDistribution = [
  ["submitted", 1500],
  ["screening", 1000],
  ["shortlisted", 700],
  ["interview", 550],
  ["technical_test", 350],
  ["offer", 170],
  ["hired", 130],
  ["rejected", 600],
];

function buildStagePool() {
  const stages = [];
  for (const [stage, count] of stageDistribution) {
    for (let index = 0; index < count; index += 1) stages.push(stage);
  }
  return stages.sort(() => random() - 0.5);
}

function buildFormSchema(family) {
  return [
    {
      id: "years_experience",
      type: "number",
      label: "Years of relevant experience",
      required: true,
      order: 1,
    },
    {
      id: "current_city",
      type: "select",
      label: "Current city",
      options: cities,
      required: true,
      order: 2,
    },
    {
      id: "expected_salary",
      type: "number",
      label: "Expected monthly salary (SAR)",
      required: true,
      order: 3,
    },
    {
      id: "notice_period",
      type: "select",
      label: "Notice period",
      options: noticePeriods,
      required: true,
      order: 4,
    },
    {
      id: "education_level",
      type: "select",
      label: "Highest education level",
      options: educationLevels,
      required: true,
      order: 5,
    },
    {
      id: "key_skills",
      type: "textarea",
      label: `List your strongest ${family.department} skills`,
      required: true,
      order: 6,
    },
    {
      id: "portfolio_link",
      type: "text",
      label: "Portfolio or LinkedIn link",
      required: false,
      order: 7,
    },
    {
      id: "can_relocate",
      type: "yesno",
      label: "Can you relocate or work in another city if needed?",
      required: false,
      order: 8,
    },
  ];
}

function stageHistoryFor(status, appliedAt, recruiterId) {
  const order = ["submitted", "screening", "shortlisted", "interview", "technical_test", "offer", "hired", "rejected"];
  const targetIndex = order.indexOf(status);
  const history = [
    {
      stage: "submitted",
      changed_by: null,
      changed_at: appliedAt.toISOString(),
      note: "Application received from public job link.",
    },
  ];

  if (targetIndex <= 0) return history;

  const normalPath = order.slice(1, status === "rejected" ? randInt(1, 5) : targetIndex + 1);
  for (let index = 0; index < normalPath.length; index += 1) {
    const stage = normalPath[index];
    history.push({
      stage,
      changed_by: recruiterId,
      changed_at: addDays(appliedAt, index + 1).toISOString(),
      note: noteForStage(stage),
    });
  }

  if (status === "rejected") {
    history.push({
      stage: "rejected",
      changed_by: recruiterId,
      changed_at: addDays(appliedAt, normalPath.length + 1).toISOString(),
      note: pick(["Salary expectation above range.", "Missing required experience.", "Another candidate was a stronger fit."]),
    });
  }

  return history;
}

function noteForStage(stage) {
  const notes = {
    screening: ["Initial screening started.", "CV is under recruiter review.", "Candidate passed basic requirements."],
    shortlisted: ["Shortlisted for manager review.", "Strong profile for the vacancy.", "Relevant experience confirmed."],
    interview: ["Interview to be scheduled.", "Moved to interview with hiring manager.", "Candidate is ready for HR interview."],
    technical_test: ["Technical task sent.", "Assessment required before final decision.", "Moved to practical evaluation."],
    offer: ["Offer preparation in progress.", "Compensation approval requested.", "Final HR review before offer."],
    hired: ["Candidate accepted the offer.", "Ready for onboarding.", "Hiring decision completed."],
  };
  return pick(notes[stage] || ["Stage updated."]);
}

function scoreCandidate(job, answers, skills, status) {
  let score = 35;
  const required = job.required_skills;
  const matched = required.filter((skill) => skills.includes(skill)).length;
  score += Math.round((matched / Math.max(required.length, 1)) * 35);
  score += Number(answers.years_experience) >= job.required_experience ? 12 : -6;
  score += Number(answers.expected_salary) <= job.salary_max ? 8 : -4;
  score += answers.current_city === job.city ? 5 : 0;
  score += answers.notice_period === "Immediately" ? 4 : 0;
  if (["shortlisted", "interview", "technical_test", "offer", "hired"].includes(status)) score += 5;
  if (status === "rejected") score -= randInt(8, 18);
  return Math.max(28, Math.min(98, score));
}

async function getOrganization() {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, slug, name")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const fallback = await supabase
    .from("organizations")
    .select("id, slug, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (fallback.error) throw fallback.error;
  if (!fallback.data) throw new Error("No organization found.");
  return fallback.data;
}

async function loadAuthUsersByEmail() {
  const usersByEmail = new Map();
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email) usersByEmail.set(user.email.toLowerCase(), user);
    }
    if (data.users.length < perPage) return usersByEmail;
    page += 1;
  }
}

async function getRecruiterUser(orgId) {
  const usersByEmail = await loadAuthUsersByEmail();
  const recruiter = usersByEmail.get("recruiter@tatwir.sa");
  if (recruiter) {
    await supabase.from("profiles").upsert(
      {
        user_id: recruiter.id,
        org_id: orgId,
        full_name: recruiter.user_metadata?.full_name || "HR Recruiter",
        email: "recruiter@tatwir.sa",
        title: "HR Recruitment Specialist",
      },
      { onConflict: "user_id" }
    );
    await supabase.from("org_members").upsert(
      { org_id: orgId, user_id: recruiter.id, role: "hr_recruitment" },
      { onConflict: "org_id,user_id" }
    );
    return recruiter;
  }

  const { data: member, error } = await supabase
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", ["hr_recruitment", "hr_admin", "admin", "super_admin"])
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!member) throw new Error("No recruiter/admin user found for this organization.");
  return { id: member.user_id, email: "existing-recruiter" };
}

async function resetRecruitmentData(orgId) {
  const deleteSteps = [
    ["notifications", (query) => query.eq("org_id", orgId).eq("type", "recruitment")],
    ["notifications", (query) => query.eq("org_id", orgId).like("link", "/recruitment%")],
    ["recruitment_messages", (query) => query.eq("org_id", orgId)],
    ["interviews", (query) => query.eq("org_id", orgId)],
    ["job_applications", (query) => query.eq("org_id", orgId)],
    ["job_postings", (query) => query.eq("org_id", orgId)],
    ["job_templates", (query) => query.eq("organization_id", orgId)],
  ];

  for (const [table, applyFilter] of deleteSteps) {
    const { error } = await applyFilter(supabase.from(table).delete());
    if (error) throw new Error(`Failed deleting ${table}: ${error.message}`);
  }
}

async function loadLookups(orgId) {
  const [{ data: departments, error: departmentsError }, { data: locations, error: locationsError }] = await Promise.all([
    supabase.from("departments").select("id, name").eq("org_id", orgId).order("name", { ascending: true }),
    supabase.from("locations").select("id, name").eq("org_id", orgId).order("name", { ascending: true }),
  ]);
  if (departmentsError) throw departmentsError;
  if (locationsError) throw locationsError;
  return { departments: departments || [], locations: locations || [] };
}

function findDepartmentId(departments, familyName) {
  const target = familyName.toLowerCase();
  return (
    departments.find((department) => String(department.name || "").toLowerCase().includes(target)) ||
    departments.find((department) => target.includes(String(department.name || "").toLowerCase())) ||
    departments[0] ||
    null
  )?.id || null;
}

function buildJobs(orgId, recruiterId, departments, locations) {
  const jobs = [];
  const now = new Date();
  for (let index = 1; index <= jobCount; index += 1) {
    const family = pick(jobFamilies);
    const title = pick(family.titles);
    const city = pick(cities);
    const salaryMin = randInt(4500, 18000);
    const salaryMax = salaryMin + randInt(2500, 9000);
    const createdAt = addDays(now, -randInt(3, 110));
    const deadline = addDays(createdAt, randInt(21, 75));
    const statusRoll = random();
    const status = statusRoll < 0.76 ? "active" : statusRoll < 0.88 ? "published" : statusRoll < 0.96 ? "closed" : "draft";
    const requiredSkills = pickMany(family.skills, 4, Math.min(7, family.skills.length));
    const requiredExperience = randInt(1, 8);
    const location = locations.length ? locations[(index - 1) % locations.length] : null;
    const companyName = pick([
      "Tatwir Talent",
      "Tatwir Field Operations",
      "STC Partner Program",
      "Mobily Retail Project",
      "Zain KSA Project",
      "Lebara KSA Operations",
      "Virgin Mobile KSA Project",
      "Salam Expansion Team",
      "Red Bull MOBILE Field Team",
    ]);
    const publicSlug = `rec-2026-${String(index).padStart(3, "0")}-${slugify(title)}-${String(randInt(100, 999))}`;
    const formSchema = buildFormSchema(family);

    jobs.push({
      id: crypto.randomUUID(),
      org_id: orgId,
      created_by: recruiterId,
      title,
      department_id: findDepartmentId(departments, family.department),
      location_id: location?.id || null,
      company_name: companyName,
      city,
      employment_type: pick(employmentTypes),
      experience_level: pick(experienceLevels),
      description: `${title} role for ${companyName} in ${city}. The role is responsible for daily execution, accurate reporting, and strong candidate or customer follow-up depending on the department.`,
      requirements: [...family.requirements, `Required skills: ${requiredSkills.join(", ")}.`, `Minimum experience: ${requiredExperience}+ years.`].join("\n"),
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_range: `${salaryMin.toLocaleString("en-US")} - ${salaryMax.toLocaleString("en-US")} SAR`,
      deadline: isoDate(deadline),
      application_deadline: isoDate(deadline),
      status,
      form_schema: formSchema,
      public_slug: ["active", "published", "open"].includes(status) ? publicSlug : null,
      created_at: createdAt.toISOString(),
      updated_at: addDays(createdAt, randInt(0, 8)).toISOString(),
      required_skills: requiredSkills,
      required_experience: requiredExperience,
    });
  }
  return jobs;
}

function buildApplicationCounts() {
  const base = Array.from({ length: jobCount }, () => 24);
  let remaining = applicationCount - base.reduce((sum, value) => sum + value, 0);
  const weights = Array.from({ length: jobCount }, (_, index) => {
    const boosted = index % 13 === 0 ? 2.3 : index % 9 === 0 ? 1.7 : 1;
    return boosted * (0.6 + random() * 1.5);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  for (let index = 0; index < jobCount; index += 1) {
    const add = Math.floor((remaining * weights[index]) / totalWeight);
    base[index] += add;
  }

  let currentTotal = base.reduce((sum, value) => sum + value, 0);
  while (currentTotal < applicationCount) {
    base[randInt(0, jobCount - 1)] += 1;
    currentTotal += 1;
  }
  while (currentTotal > applicationCount) {
    const index = randInt(0, jobCount - 1);
    if (base[index] > 1) {
      base[index] -= 1;
      currentTotal -= 1;
    }
  }
  return base;
}

function candidateName(index) {
  const first = index % 5 === 0 ? pick(femaleFirstNames) : pick(maleFirstNames);
  const father = pick([...maleFirstNames, "Saleh", "Tariq", "Yahya", "Hamad"]);
  const last = pick(lastNames);
  return `${first} ${father} ${last}`;
}

function buildApplication(job, appIndex, status, recruiterId) {
  const name = candidateName(appIndex);
  const emailName = name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.+|\.+$/g, "");
  const appliedAt = addDays(new Date(), -randInt(0, 78));
  appliedAt.setHours(randInt(8, 21), randInt(0, 59), randInt(0, 59), 0);
  const candidateSkills = pickMany(
    [...job.required_skills, "Leadership", "Microsoft Office", "Presentation", "English", "Data Entry", "Customer Care"],
    3,
    8
  );
  const experience = randInt(0, 12);
  const expectedSalary = randInt(Math.max(3500, job.salary_min - 2500), job.salary_max + 6500);
  const city = random() < 0.58 ? job.city : pick(cities);
  const answers = {
    years_experience: String(experience),
    current_city: city,
    expected_salary: String(expectedSalary),
    notice_period: pick(noticePeriods),
    education_level: pick(educationLevels),
    key_skills: candidateSkills.join(", "),
    portfolio_link: random() < 0.46 ? `https://${pick(portfolioDomains)}/${emailName.replace(/\./g, "-")}` : "",
    can_relocate: random() < 0.64 ? "Yes" : "No",
  };
  const score = scoreCandidate(job, answers, candidateSkills, status);
  const redFlags = [];
  const highlights = [];

  if (expectedSalary > job.salary_max) redFlags.push("Salary expectation is above job range");
  if (experience < job.required_experience) redFlags.push("Experience below preferred requirement");
  if (!candidateSkills.some((skill) => job.required_skills.includes(skill))) redFlags.push("Missing core required skills");
  if (experience >= job.required_experience + 2) highlights.push(`${experience} years of relevant experience`);
  if (answers.notice_period === "Immediately") highlights.push("Available immediately");
  if (answers.portfolio_link) highlights.push("Has portfolio or professional link");
  if (city === job.city) highlights.push("Location matches the role");

  const application = {
    id: crypto.randomUUID(),
    org_id: job.org_id,
    job_posting_id: job.id,
    candidate_user_id: null,
    candidate_id: null,
    candidate_name: name,
    email: `${emailName}.${appIndex}@example-candidates.tatwir.sa`,
    phone: phoneFor(appIndex),
    resume_url: `https://mxifsvgrkxoyskkiaqzs.supabase.co/storage/v1/object/public/recruitment/mock-cvs/candidate-${appIndex}.pdf`,
    cv_url: `https://mxifsvgrkxoyskkiaqzs.supabase.co/storage/v1/object/public/recruitment/mock-cvs/candidate-${appIndex}.pdf`,
    status,
    answers,
    application_answers: answers,
    source: pick(sources),
    status_history: stageHistoryFor(status, appliedAt, recruiterId),
    stage_history: stageHistoryFor(status, appliedAt, recruiterId),
    extracted_skills: candidateSkills,
    highlights,
    red_flags: redFlags,
    match_score: score,
    score,
    recruiter_notes:
      status === "rejected"
        ? pick(["Good communication, but not enough direct experience.", "Keep for future junior vacancies.", "Rejected after salary alignment review."])
        : random() < 0.42
          ? pick(["Strong phone screen.", "Potential fit for another branch.", "Manager requested follow-up.", "CV matches most requirements."])
          : null,
    applied_at: appliedAt.toISOString(),
    updated_at: addDays(appliedAt, randInt(0, 12)).toISOString(),
  };
  return application;
}

function buildApplications(jobs, recruiterId) {
  const counts = buildApplicationCounts();
  const stages = buildStagePool();
  const applications = [];
  let appIndex = 1;

  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    const job = jobs[jobIndex];
    for (let countIndex = 0; countIndex < counts[jobIndex]; countIndex += 1) {
      const status = stages[appIndex - 1] || "submitted";
      applications.push(buildApplication(job, appIndex, status, recruiterId));
      appIndex += 1;
    }
  }

  return applications.sort((a, b) => new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime());
}

function buildInterviews(applications, recruiterId) {
  const eligible = applications.filter((application) =>
    ["interview", "technical_test", "offer", "hired", "rejected"].includes(application.status)
  );
  const selected = eligible.filter((application) => application.status !== "rejected" || random() < 0.28);
  return selected.slice(0, 980).map((application) => {
    const scheduledAt = addDays(new Date(application.applied_at), randInt(2, 18));
    scheduledAt.setHours(randInt(10, 18), pick([0, 15, 30, 45]), 0, 0);
    const type = pick(["phone", "video", "in_person"]);
    const result =
      application.status === "rejected"
        ? "failed"
        : ["offer", "hired"].includes(application.status)
          ? "passed"
          : pick(["pending", "pending", "passed"]);
    return {
      id: crypto.randomUUID(),
      org_id: application.org_id,
      job_application_id: application.id,
      interview_date: scheduledAt.toISOString(),
      scheduled_at: scheduledAt.toISOString(),
      location: type === "video" ? "Microsoft Teams" : type === "phone" ? "Phone call" : pick(["Riyadh HQ", "Jeddah Branch", "Dammam Branch", "Remote assessment room"]),
      type,
      notes: pick(["Initial HR interview.", "Hiring manager discussion.", "Technical and culture fit review.", "Final screening conversation."]),
      feedback:
        result === "pending"
          ? null
          : result === "passed"
            ? pick(["Strong communication and relevant background.", "Good fit for the branch requirement.", "Recommended for next step."])
            : pick(["Did not meet required experience level.", "Salary expectation was outside range.", "Communication did not match role needs."]),
      result,
      created_by: recruiterId,
      created_at: addDays(scheduledAt, -1).toISOString(),
    };
  });
}

function buildMessages(applications, recruiterId) {
  const messageTemplates = {
    submitted: ["Application received", "Thank you for applying. Your application is now under review."],
    screening: ["Screening started", "Your profile is being reviewed by the recruitment team."],
    shortlisted: ["Shortlisted", "You have been shortlisted for the next step."],
    interview: ["Interview invitation", "We would like to schedule an interview for your application."],
    technical_test: ["Technical assessment", "A technical assessment is required for the next step."],
    offer: ["Offer preparation", "Your offer is under final HR review."],
    hired: ["Hiring confirmation", "Congratulations, your hiring process has been completed."],
    rejected: ["Application update", "Thank you for your interest. We will not proceed with this vacancy."],
  };

  return applications
    .filter((application) => application.status !== "submitted" && random() < 0.36)
    .slice(0, 1250)
    .map((application) => {
      const [subject, body] = messageTemplates[application.status] || messageTemplates.screening;
      return {
        id: crypto.randomUUID(),
        org_id: application.org_id,
        job_application_id: application.id,
        sender_user_id: recruiterId,
        candidate_user_id: null,
        template_key: application.status,
        subject,
        body,
        sent_at: addDays(new Date(application.applied_at), randInt(1, 10)).toISOString(),
      };
    });
}

function buildTemplates(orgId, recruiterId, departments) {
  return jobFamilies.flatMap((family) =>
    family.titles.slice(0, 3).map((title) => ({
      id: crypto.randomUUID(),
      organization_id: orgId,
      created_by: recruiterId,
      title,
      description: `Reusable recruitment template for ${title} vacancies.`,
      requirements: family.requirements.join("\n"),
      form_schema: buildFormSchema(family),
      employment_type: "full_time",
      department_id: findDepartmentId(departments, family.department),
      company_name: "Tatwir Talent",
      created_at: addDays(new Date(), -randInt(1, 30)).toISOString(),
    }))
  );
}

async function insertChunked(table, rows, size = 500) {
  const inserted = [];
  for (const rowsChunk of chunk(rows, size)) {
    const { data, error } = await supabase.from(table).insert(rowsChunk).select();
    if (error) throw new Error(`Failed inserting ${table}: ${error.message}`);
    if (data) inserted.push(...data);
    console.log(`Inserted ${Math.min(inserted.length, rows.length)}/${rows.length} into ${table}`);
  }
  return inserted;
}

async function printCounts(orgId) {
  const tables = [
    ["job_postings", "org_id"],
    ["job_applications", "org_id"],
    ["interviews", "org_id"],
    ["recruitment_messages", "org_id"],
    ["job_templates", "organization_id"],
  ];

  console.log("\nRecruitment mock seed summary");
  for (const [table, column] of tables) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, orgId);
    if (error) throw error;
    console.log(`${table}: ${count}`);
  }

  const statusCounts = {};
  for (const status of ["submitted", "screening", "shortlisted", "interview", "technical_test", "offer", "hired", "rejected"]) {
    const { count, error } = await supabase
      .from("job_applications")
      .select("*", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", status);
    if (error) throw error;
    statusCounts[status] = count || 0;
  }
  console.log(`application status distribution: ${JSON.stringify(statusCounts)}`);
}

async function main() {
  const organization = await getOrganization();
  const recruiter = await getRecruiterUser(organization.id);
  const { departments, locations } = await loadLookups(organization.id);

  console.log(`Seeding recruitment mock data for ${organization.name} (${organization.slug})`);
  console.log(`Recruiter owner: ${recruiter.email || recruiter.id}`);

  await resetRecruitmentData(organization.id);
  console.log("Existing recruitment data was removed.");

  const jobsWithMeta = buildJobs(organization.id, recruiter.id, departments, locations);
  const jobs = jobsWithMeta.map(({ required_skills, required_experience, ...job }) => job);
  const insertedJobs = await insertChunked("job_postings", jobs, 100);
  const jobMetaById = new Map(jobsWithMeta.map((job) => [job.id, job]));
  const jobsForApplications = insertedJobs.map((job) => ({ ...job, ...jobMetaById.get(job.id) }));

  const templates = buildTemplates(organization.id, recruiter.id, departments);
  await insertChunked("job_templates", templates, 100);

  const applications = buildApplications(jobsForApplications, recruiter.id);
  const insertedApplications = await insertChunked("job_applications", applications, 500);

  const interviews = buildInterviews(insertedApplications, recruiter.id);
  await insertChunked("interviews", interviews, 500);

  const messages = buildMessages(insertedApplications, recruiter.id);
  await insertChunked("recruitment_messages", messages, 500);

  await printCounts(organization.id);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
