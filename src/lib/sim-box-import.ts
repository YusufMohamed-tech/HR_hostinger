export type KitCodeGenerationResult = {
  kitCodes: string[];
  step: number;
  errors: string[];
  warnings: string[];
};

export type SimBoxImportInput = {
  provider?: string | null;
  first_kitcode?: string | null;
  last_kitcode?: string | null;
  quantity?: number | string | null;
  step?: number | string | null;
};

export type SimBoxValidationResult = KitCodeGenerationResult & {
  provider: string;
  firstKitcode: string;
  lastKitcode: string;
  quantity: number;
  isValid: boolean;
};

export function normalizeKitCode(value: string) {
  return String(value || "").trim().replace(/\s+/g, "");
}

export function normalizeProvider(value: unknown) {
  return String(value || "virgin").trim().toLowerCase() || "virgin";
}

export function safeProviderSlug(value: unknown) {
  return normalizeProvider(value).replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "provider";
}

export function parseDealerBox(value: unknown): { dealerBoxNumber: number | null; dealerBoxTotal: number | null } {
  const text = String(value || "").trim();
  const match = text.match(/(\d+)\s*(?:of|\/|من)\s*(\d+)/i);
  if (!match) return { dealerBoxNumber: null, dealerBoxTotal: null };
  return {
    dealerBoxNumber: Number(match[1]),
    dealerBoxTotal: Number(match[2]),
  };
}

function parseQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isInteger(quantity) ? quantity : 0;
}

function numericString(value: string) {
  return /^\d+$/.test(value);
}

export function generateKitCodes(first: string, last: string, quantityInput: number): KitCodeGenerationResult {
  const firstKitcode = normalizeKitCode(first);
  const lastKitcode = normalizeKitCode(last);
  const quantity = parseQuantity(quantityInput);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!firstKitcode) errors.push("First kitcode is required.");
  if (!lastKitcode) errors.push("Last kitcode is required.");
  if (!numericString(firstKitcode)) errors.push("First kitcode must contain digits only.");
  if (!numericString(lastKitcode)) errors.push("Last kitcode must contain digits only.");
  if (quantity <= 0) errors.push("Quantity must be a positive integer.");
  if (firstKitcode && lastKitcode && firstKitcode.length !== lastKitcode.length) {
    errors.push("First and last kitcode must have the same length.");
  }

  if (errors.length > 0) return { kitCodes: [], step: 0, errors, warnings };

  const firstNumber = Number(firstKitcode);
  const lastNumber = Number(lastKitcode);

  if (!Number.isSafeInteger(firstNumber) || !Number.isSafeInteger(lastNumber)) {
    errors.push("Kitcode values are too large to generate safely.");
    return { kitCodes: [], step: 0, errors, warnings };
  }

  if (quantity === 1) {
    if (firstNumber !== lastNumber) {
      errors.push("When quantity is 1, first and last kitcode must match.");
      return { kitCodes: [], step: 0, errors, warnings };
    }
    return { kitCodes: [firstKitcode], step: 0, errors, warnings };
  }

  if (lastNumber <= firstNumber) {
    errors.push("Last kitcode must be greater than first kitcode.");
    return { kitCodes: [], step: 0, errors, warnings };
  }

  const difference = lastNumber - firstNumber;
  const divisor = quantity - 1;
  if (difference % divisor !== 0) {
    errors.push("Kitcode range does not divide evenly by quantity.");
    return { kitCodes: [], step: 0, errors, warnings };
  }

  const step = difference / divisor;
  if (!Number.isInteger(step) || step <= 0) {
    errors.push("Generated step must be a positive integer.");
    return { kitCodes: [], step: 0, errors, warnings };
  }

  const kitCodes = Array.from({ length: quantity }, (_, index) =>
    String(firstNumber + step * index).padStart(firstKitcode.length, "0")
  );

  if (kitCodes.length !== quantity) {
    errors.push("Generated count does not match quantity.");
  }
  if (kitCodes.at(-1) !== lastKitcode) {
    errors.push("Generated final kitcode does not match last kitcode.");
  }

  return { kitCodes, step, errors, warnings };
}

export function validateSimBoxImportInput(input: SimBoxImportInput): SimBoxValidationResult {
  const provider = normalizeProvider(input.provider);
  const firstKitcode = normalizeKitCode(String(input.first_kitcode || ""));
  const lastKitcode = normalizeKitCode(String(input.last_kitcode || ""));
  const quantity = parseQuantity(input.quantity);
  const generation = generateKitCodes(firstKitcode, lastKitcode, quantity);
  const errors = [...generation.errors];

  if (!provider) errors.push("Provider is required.");
  const expectedStep = input.step == null || input.step === "" ? generation.step : Number(input.step);
  if (input.step != null && input.step !== "" && Number.isInteger(expectedStep) && generation.errors.length === 0 && expectedStep !== generation.step) {
    errors.push("Provided step does not match the generated step.");
  }

  return {
    provider,
    firstKitcode,
    lastKitcode,
    quantity,
    kitCodes: generation.kitCodes,
    step: generation.step,
    errors,
    warnings: generation.warnings,
    isValid: errors.length === 0,
  };
}
