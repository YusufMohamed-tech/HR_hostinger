import { z } from "zod";

const questionTypes = ["text", "textarea", "select", "file", "date", "yesno", "number"] as const;

const optionsSchema = z.preprocess(
  (value) => typeof value === "string"
    ? value.split(/[,،]/u).map((option) => option.trim()).filter(Boolean)
    : value,
  z.array(z.string().trim().min(1).max(300)).max(100).optional(),
);

export const recruitmentFormQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/u),
  type: z.enum(questionTypes),
  label: z.string().trim().min(1).max(500),
  options: optionsSchema,
  required: z.boolean().default(false),
  order: z.coerce.number().int().min(0).max(1_000),
  accept: z.string().trim().max(500).optional(),
}).superRefine((question, context) => {
  if (question.type === "select" && (!question.options || question.options.length === 0)) {
    context.addIssue({ code: "custom", path: ["options"], message: "Select questions require options." });
  }
  if (question.options && new Set(question.options).size !== question.options.length) {
    context.addIssue({ code: "custom", path: ["options"], message: "Question options must be unique." });
  }
});

export const recruitmentFormSchema = z.array(recruitmentFormQuestionSchema).max(50).superRefine((questions, context) => {
  const seen = new Set<string>();
  for (const [index, question] of questions.entries()) {
    if (seen.has(question.id)) {
      context.addIssue({ code: "custom", path: [index, "id"], message: "Question IDs must be unique." });
    }
    seen.add(question.id);
  }
});

export type RecruitmentFormQuestion = z.infer<typeof recruitmentFormQuestionSchema>;

function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validatePublicApplicationAnswers(
  questions: RecruitmentFormQuestion[],
  answers: Record<string, string>,
  fileQuestionIds: ReadonlySet<string>,
) {
  const issues: string[] = [];
  const questionIds = new Set(questions.map((question) => question.id));

  for (const key of Object.keys(answers)) {
    if (!questionIds.has(key)) issues.push(`Unknown answer field: ${key}`);
  }
  for (const questionId of fileQuestionIds) {
    const question = questions.find((candidate) => candidate.id === questionId);
    if (!question || question.type !== "file") issues.push(`Unknown file field: ${questionId}`);
  }

  for (const question of questions) {
    const answer = answers[question.id]?.trim() ?? "";
    const hasFile = fileQuestionIds.has(question.id);
    if (question.required && (question.type === "file" ? !hasFile : !answer)) {
      issues.push(`Required answer is missing: ${question.id}`);
      continue;
    }
    if (question.type === "file") {
      if (answer) issues.push(`File question must be uploaded: ${question.id}`);
      continue;
    }
    if (!answer) continue;
    if (answer.length > 20_000) issues.push(`Answer is too long: ${question.id}`);
    if (question.type === "select" && !question.options?.includes(answer)) {
      issues.push(`Answer is not an allowed option: ${question.id}`);
    }
    if (question.type === "yesno" && !["نعم", "لا", "yes", "no"].includes(answer.toLowerCase())) {
      issues.push(`Answer must be yes or no: ${question.id}`);
    }
    if (question.type === "number" && (!Number.isFinite(Number(answer)) || answer.length > 100)) {
      issues.push(`Answer must be a finite number: ${question.id}`);
    }
    if (question.type === "date" && !validDate(answer)) {
      issues.push(`Answer must be a valid date: ${question.id}`);
    }
  }

  return { valid: issues.length === 0, issues };
}
