export type ParsedSimBoxLabel = {
  provider: string | null;
  order_number: string | null;
  batch_number: string | null;
  barcode_text: string | null;
  first_kitcode: string | null;
  last_kitcode: string | null;
  quantity: number | null;
  dealer_box_number: number | null;
  dealer_box_total: number | null;
  confidence?: number;
  raw_notes: string[];
  raw_ocr_text?: string;
};

function cleanText(value: string) {
  return String(value || "").replace(/\r/g, "\n");
}

function compactSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return compactSpaces(match[1]);
  }
  return null;
}

function numericMatch(text: string, patterns: RegExp[]) {
  const value = firstMatch(text, patterns);
  if (!value) return null;
  const normalized = value.replace(/[^\d]/g, "");
  return normalized ? Number(normalized) : null;
}

function kitCodeMatch(text: string, patterns: RegExp[]) {
  const value = firstMatch(text, patterns);
  if (!value) return null;
  const normalized = value.replace(/\D/g, "");
  return normalized || null;
}

export function parseSimBoxText(text: string): ParsedSimBoxLabel {
  const source = cleanText(text);
  const rawNotes: string[] = [];
  const provider =
    firstMatch(source, [
      /\bCustomer\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 &._/-]{1,80})/i,
      /\bProvider\s*[:#-]?\s*([A-Za-z][A-Za-z0-9 &._/-]{1,80})/i,
    ]) || null;
  const orderNumber = firstMatch(source, [/\bOrder\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,80})/i]);
  const batchNumber = firstMatch(source, [
    /\bBatch\s*(?:#|No\.?|Number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,80})/i,
  ]);
  const firstKitcode = kitCodeMatch(source, [
    /\bFirst\s*Kit\s*code\s*[:#-]?\s*([0-9][0-9\s-]{2,80})/i,
    /\bFirst\s*Kitcode\s*[:#-]?\s*([0-9][0-9\s-]{2,80})/i,
  ]);
  const lastKitcode = kitCodeMatch(source, [
    /\bLast\s*Kit\s*code\s*[:#-]?\s*([0-9][0-9\s-]{2,80})/i,
    /\bLast\s*Kitcode\s*[:#-]?\s*([0-9][0-9\s-]{2,80})/i,
  ]);
  const quantity = numericMatch(source, [/\bQuantity\s*[:#-]?\s*(\d{1,8})/i, /\bQty\s*[:#-]?\s*(\d{1,8})/i]);
  const dealerBox = source.match(/\bDealer\s*Box\s*[:#-]?\s*(\d+)\s*(?:of|\/)\s*(\d+)/i);
  const dealerBoxNumber = dealerBox?.[1] ? Number(dealerBox[1]) : null;
  const dealerBoxTotal = dealerBox?.[2] ? Number(dealerBox[2]) : null;

  if (!provider) rawNotes.push("Provider/customer was not detected.");
  if (!orderNumber) rawNotes.push("Order number was not detected.");
  if (!batchNumber) rawNotes.push("Batch number was not detected.");
  if (!firstKitcode) rawNotes.push("First kitcode was not detected.");
  if (!lastKitcode) rawNotes.push("Last kitcode was not detected.");
  if (!quantity) rawNotes.push("Quantity was not detected.");
  if (!dealerBoxNumber || !dealerBoxTotal) rawNotes.push("Dealer box number was not detected.");

  return {
    provider,
    order_number: orderNumber,
    batch_number: batchNumber,
    barcode_text: null,
    first_kitcode: firstKitcode,
    last_kitcode: lastKitcode,
    quantity,
    dealer_box_number: dealerBoxNumber,
    dealer_box_total: dealerBoxTotal,
    raw_notes: rawNotes,
    raw_ocr_text: source,
  };
}

export async function extractTextWithTesseract(file: File): Promise<{ text: string; confidence?: number }> {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(file, "eng");
  return {
    text: result.data.text || "",
    confidence: typeof result.data.confidence === "number" ? result.data.confidence : undefined,
  };
}

export async function extractBarcodeWithZxing(file: File): Promise<string | null> {
  const { BrowserMultiFormatReader } = await import("@zxing/browser");
  const reader = new BrowserMultiFormatReader();
  const url = URL.createObjectURL(file);
  try {
    const result = await reader.decodeFromImageUrl(url);
    return result.getText();
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
