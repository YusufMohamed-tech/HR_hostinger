function compactSpaces(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return compactSpaces(match[1]);
  }
  return null;
}

function kitCodeMatch(text, patterns) {
  const value = firstMatch(text, patterns);
  if (!value) return null;
  const normalized = value.replace(/\D/g, "");
  return normalized || null;
}

function parseSimBoxText(text) {
  const provider =
    firstMatch(text, [
      /\bCustomer\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 &._/-]{1,80})/i,
      /\bProvider\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 &._/-]{1,80})/i,
    ]) || null;
  const orderNumber = firstMatch(text, [/\bOrder\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,80})/i]);
  const batchNumber = firstMatch(text, [/\bBatch\s*(?:#|No\.?|Number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,80})/i]);
  const firstKitcode = kitCodeMatch(text, [/\bFirst\s*Kit\s*code\s*[:#-]?\s*([0-9][0-9\s-]{2,80})/i, /\bFirst\s*Kitcode\s*[:#-]?\s*([0-9][0-9\s-]{2,80})/i]);
  const lastKitcode = kitCodeMatch(text, [/\bLast\s*Kit\s*code\s*[:#-]?\s*([0-9][0-9\s-]{2,80})/i, /\bLast\s*Kitcode\s*[:#-]?\s*([0-9][0-9\s-]{2,80})/i]);
  const quantity = Number(firstMatch(text, [/\bQuantity\s*[:#-]?\s*(\d{1,8})/i, /\bQty\s*[:#-]?\s*(\d{1,8})/i]) || 0) || null;
  const dealerBox = text.match(/\bDealer\s*Box\s*[:#-]?\s*(\d+)\s*(?:of|\/)\s*(\d+)/i);
  return {
    provider,
    order_number: orderNumber,
    batch_number: batchNumber,
    first_kitcode: firstKitcode,
    last_kitcode: lastKitcode,
    quantity,
    dealer_box_number: dealerBox?.[1] ? Number(dealerBox[1]) : null,
    dealer_box_total: dealerBox?.[2] ? Number(dealerBox[2]) : null,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const parsed = parseSimBoxText(`
Customer: Virgin Mobile
Order: P019-060010
Batch #: VMKSA162
First Kitcode: 0042981100
Last Kitcode: 0042981290
Quantity: 20
Dealer Box: 605 of 5000
`);

assert(parsed.provider === "Virgin Mobile", "Expected provider/customer parse.");
assert(parsed.order_number === "P019-060010", "Expected order parse.");
assert(parsed.batch_number === "VMKSA162", "Expected batch parse.");
assert(parsed.first_kitcode === "0042981100", "Expected first kitcode with leading zeros.");
assert(parsed.last_kitcode === "0042981290", "Expected last kitcode with leading zeros.");
assert(parsed.quantity === 20, "Expected quantity parse.");
assert(parsed.dealer_box_number === 605, "Expected dealer box number parse.");
assert(parsed.dealer_box_total === 5000, "Expected dealer box total parse.");

const missing = parseSimBoxText("unreadable photo text");
assert(missing.first_kitcode === null && missing.quantity === null, "Expected unclear values to remain blank.");

console.log("SIM box parser tests passed.");
