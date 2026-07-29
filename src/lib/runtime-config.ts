export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type RuntimeConfigurationIssue = {
  field: string;
  reason: string;
};

export type RuntimeConfigurationStatus = {
  ready: boolean;
  production: boolean;
  issues: RuntimeConfigurationIssue[];
};

const coreFields = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const productionSecretFields = [
  "OUTBOX_WORKER_SECRET",
  "COMPLIANCE_WORKER_SECRET",
  "FILE_RETENTION_WORKER_SECRET",
  "AUDIT_EVIDENCE_SECRET",
  "RATE_LIMIT_HASH_SECRET",
] as const;

const hostingerPersonnelStorageFields = [
  "HOSTINGER_OBJECT_STORAGE_ENDPOINT",
  "HOSTINGER_OBJECT_STORAGE_REGION",
  "HOSTINGER_OBJECT_STORAGE_ACCESS_KEY",
  "HOSTINGER_OBJECT_STORAGE_SECRET_KEY",
  "HOSTINGER_OBJECT_STORAGE_BUCKET",
] as const;

const dangerousProductionFlags = [
  "ALLOW_DESTRUCTIVE_SCHEMA_APPLY",
  "ALLOW_DESTRUCTIVE_MIGRATION",
  "ALLOW_MIGRATION_ADOPTION",
  "NEXT_PUBLIC_SHOW_DEMO_LOGINS",
] as const;

function value(environment: RuntimeEnvironment, field: string) {
  return environment[field]?.trim() ?? "";
}

function isPlaceholder(candidate: string) {
  return /your[_-]|placeholder|change[_-]?me|example(?:\.com)?|replace[_-]?me/iu.test(candidate);
}

function parseUrl(candidate: string) {
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

export function validateRuntimeConfiguration(
  environment: RuntimeEnvironment = process.env,
): RuntimeConfigurationStatus {
  const production = value(environment, "NODE_ENV") === "production";
  const issues: RuntimeConfigurationIssue[] = [];
  const addIssue = (field: string, reason: string) => issues.push({ field, reason });

  for (const field of coreFields) {
    const configured = value(environment, field);
    if (!configured) addIssue(field, "missing");
    else if (isPlaceholder(configured)) addIssue(field, "placeholder");
  }

  const supabaseUrl = value(environment, "NEXT_PUBLIC_SUPABASE_URL");
  if (supabaseUrl && !isPlaceholder(supabaseUrl)) {
    const parsed = parseUrl(supabaseUrl);
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
      addIssue("NEXT_PUBLIC_SUPABASE_URL", "invalid_url");
    } else if (production && parsed.protocol !== "https:") {
      addIssue("NEXT_PUBLIC_SUPABASE_URL", "https_required");
    }
  }

  const anonKey = value(environment, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = value(environment, "SUPABASE_SERVICE_ROLE_KEY");
  if (anonKey && serviceRoleKey && anonKey === serviceRoleKey) {
    addIssue("SUPABASE_SERVICE_ROLE_KEY", "must_differ_from_anon_key");
  }

  if (production) {
    const hostingerPersonnelStorageRequested = hostingerPersonnelStorageFields
      .some((field) => Boolean(value(environment, field)));
    if (hostingerPersonnelStorageRequested) {
      for (const field of hostingerPersonnelStorageFields) {
        const configured = value(environment, field);
        if (!configured) addIssue(field, "missing");
        else if (isPlaceholder(configured)) addIssue(field, "placeholder");
      }
    }
    const hostingerEndpoint = value(environment, "HOSTINGER_OBJECT_STORAGE_ENDPOINT");
    if (hostingerEndpoint) {
      const parsed = parseUrl(hostingerEndpoint);
      if (!parsed || parsed.protocol !== "https:") {
        addIssue("HOSTINGER_OBJECT_STORAGE_ENDPOINT", "valid_https_url_required");
      }
    }
    const encryption = value(environment, "HOSTINGER_OBJECT_STORAGE_ENCRYPTION") || "AES256";
    if (hostingerPersonnelStorageRequested && !["AES256", "aws:kms"].includes(encryption)) {
      addIssue("HOSTINGER_OBJECT_STORAGE_ENCRYPTION", "must_be_AES256_or_aws:kms");
    }
    if (hostingerPersonnelStorageRequested
      && encryption === "aws:kms"
      && !value(environment, "HOSTINGER_OBJECT_STORAGE_KMS_KEY_ID")) {
      addIssue("HOSTINGER_OBJECT_STORAGE_KMS_KEY_ID", "required_for_aws_kms");
    }

    for (const field of productionSecretFields) {
      const configured = value(environment, field);
      if (!configured) addIssue(field, "missing");
      else if (configured.length < 32) addIssue(field, "minimum_32_characters");
      else if (isPlaceholder(configured)) addIssue(field, "placeholder");
    }

    const configuredSecrets = productionSecretFields
      .map((field) => [field, value(environment, field)] as const)
      .filter(([, configured]) => configured.length >= 32);
    for (const [index, [field, configured]] of configuredSecrets.entries()) {
      if (configuredSecrets.slice(index + 1).some(([, other]) => other === configured)) {
        addIssue(field, "must_not_be_reused");
      }
    }

    for (const field of dangerousProductionFlags) {
      if (value(environment, field).toLowerCase() === "true") addIssue(field, "must_be_disabled");
    }
  }

  return { ready: issues.length === 0, production, issues };
}
