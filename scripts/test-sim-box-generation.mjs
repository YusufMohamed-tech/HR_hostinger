function normalizeKitCode(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function generateKitCodes(first, last, quantity) {
  const firstKitcode = normalizeKitCode(first);
  const lastKitcode = normalizeKitCode(last);
  const errors = [];
  if (!/^\d+$/.test(firstKitcode)) errors.push("First kitcode must contain digits only.");
  if (!/^\d+$/.test(lastKitcode)) errors.push("Last kitcode must contain digits only.");
  if (!Number.isInteger(quantity) || quantity <= 0) errors.push("Quantity must be a positive integer.");
  if (firstKitcode.length !== lastKitcode.length) errors.push("First and last kitcode must have the same length.");
  if (errors.length) return { kitCodes: [], step: 0, errors };
  const firstNumber = Number(firstKitcode);
  const lastNumber = Number(lastKitcode);
  if (quantity === 1) {
    if (firstNumber !== lastNumber) return { kitCodes: [], step: 0, errors: ["When quantity is 1, first and last kitcode must match."] };
    return { kitCodes: [firstKitcode], step: 0, errors };
  }
  if (lastNumber <= firstNumber) return { kitCodes: [], step: 0, errors: ["Last kitcode must be greater than first kitcode."] };
  const difference = lastNumber - firstNumber;
  const divisor = quantity - 1;
  if (difference % divisor !== 0) return { kitCodes: [], step: 0, errors: ["Kitcode range does not divide evenly by quantity."] };
  const step = difference / divisor;
  return {
    kitCodes: Array.from({ length: quantity }, (_, index) => String(firstNumber + step * index).padStart(firstKitcode.length, "0")),
    step,
    errors,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const valid = generateKitCodes("0042981100", "0042981290", 20);
assert(valid.errors.length === 0, "Expected valid range.");
assert(valid.step === 10, "Expected step 10.");
assert(valid.kitCodes.length === 20, "Expected 20 generated codes.");
assert(valid.kitCodes[0] === "0042981100", "Expected leading zeros on first code.");
assert(valid.kitCodes.at(-1) === "0042981290", "Expected last code to match.");

const invalid = generateKitCodes("0042981100", "0042981291", 20);
assert(invalid.errors.length > 0, "Expected non-divisible range to fail.");

const singleValid = generateKitCodes("0007", "0007", 1);
assert(singleValid.errors.length === 0 && singleValid.kitCodes[0] === "0007" && singleValid.step === 0, "Expected quantity=1 matching range to pass.");

const singleInvalid = generateKitCodes("0007", "0008", 1);
assert(singleInvalid.errors.length > 0, "Expected quantity=1 mismatched range to fail.");

console.log("SIM box generation tests passed. Duplicate handling is intentionally API/database-scoped.");
