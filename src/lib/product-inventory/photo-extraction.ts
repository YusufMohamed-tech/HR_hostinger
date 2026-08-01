import { normalizeSerial } from "@/lib/product-inventory/normalization";
import { createLocalEnglishOcrWorker } from "@/lib/ocr/local-tesseract";
import {
  matchProductCatalog,
  normalizeProductMatchValue,
  type CatalogAlias,
} from "@/lib/product-inventory/workbook";
import type {
  ProductInventoryPhotoCandidate,
  ProductInventoryProduct,
} from "@/types/product-inventory";

export const PRODUCT_PHOTO_EXTRACTION_VERSION = "local-product-label-v1";

export type ProductPhotoBoundingBox = {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type ProductPhotoRawExtraction = {
  raw_text: string;
  ocr_confidence: number | null;
  barcode_values: string[];
  bounding_boxes: ProductPhotoBoundingBox[];
  engine: "tesseract-zxing-local";
  version: typeof PRODUCT_PHOTO_EXTRACTION_VERSION;
};

export interface ProductExtractionProvider {
  extract(file: File): Promise<ProductPhotoRawExtraction>;
  close?(): Promise<void>;
}

function firstLabelValue(text: string, labels: string[]) {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:${escaped})\\s*[:#-]?\\s*([^\\n\\r]{2,160})`, "iu");
  return text.match(pattern)?.[1]?.trim() || "";
}

function serialLabelValues(text: string) {
  const values: string[] = [];
  const pattern = /(?:^|\n)\s*(?:s\/?n|serial(?:\s*(?:no|number))?|imei(?:\s*[12])?|الرقم\s*التسلسلي|السيريال)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,159})/giu;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) values.push(match[1].trim());
  }
  return [...new Map(values.map((value) => [normalizeSerial(value), value])).values()];
}

function statusForCandidate(errors: string[], warnings: string[], duplicate: boolean, unmatched: boolean) {
  if (duplicate) return "duplicate" as const;
  if (unmatched) return "unmatched" as const;
  if (errors.length > 0) return "invalid" as const;
  if (warnings.length > 0) return "warning" as const;
  return "valid" as const;
}

export function parseProductPhotoExtraction(
  extraction: ProductPhotoRawExtraction,
  context: {
    sourceId: string;
    products: ProductInventoryProduct[];
    aliases?: CatalogAlias[];
    defaultCurrency?: string;
    existingSerials?: Set<string>;
    draftSerials?: Set<string>;
    seenSerials?: Set<string>;
  }
) {
  const rawText = String(extraction.raw_text || "").replace(/\r/gu, "\n");
  const productName = firstLabelValue(rawText, [
    "product name", "product", "item", "description", "اسم المنتج", "المنتج",
  ]);
  const sku = firstLabelValue(rawText, ["sku", "product code", "item code", "كود المنتج", "رمز المنتج"])
    .split(/\s+/u)[0] || "";
  const model = firstLabelValue(rawText, ["model", "model no", "model number", "الموديل", "الطراز"])
    .split(/\s+/u)[0] || "";
  const barcodeValues = [...new Map(
    extraction.barcode_values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => [normalizeProductMatchValue(value), value])
  ).values()];

  let match = matchProductCatalog(
    { sku, name: productName, barcode: "", model },
    context.products,
    context.aliases ?? []
  );
  let productBarcode = "";
  if (!match.product) {
    for (const barcode of barcodeValues) {
      const barcodeMatch = matchProductCatalog(
        { sku, name: productName, barcode, model },
        context.products,
        context.aliases ?? []
      );
      if (barcodeMatch.product) {
        match = barcodeMatch;
        productBarcode = barcode;
        break;
      }
    }
  } else {
    productBarcode = barcodeValues.find((barcode) =>
      normalizeProductMatchValue(match.product?.barcode) === normalizeProductMatchValue(barcode)
    ) || "";
  }

  const labeledSerials = serialLabelValues(rawText);
  const fallbackBarcodes = barcodeValues.filter((barcode) => barcode !== productBarcode);
  const rawSerials = labeledSerials.length > 0
    ? labeledSerials
    : fallbackBarcodes.length > 0 ? fallbackBarcodes : [""];
  const seen = context.seenSerials ?? new Set<string>();

  return rawSerials.map((serial, index): ProductInventoryPhotoCandidate => {
    const normalizedSerial = normalizeSerial(serial);
    const errors: string[] = [];
    const warnings: string[] = [];
    const duplicate = Boolean(normalizedSerial && seen.has(normalizedSerial));
    if (normalizedSerial) seen.add(normalizedSerial);
    if (!match.product) errors.push("Product could not be matched to the selected supplier catalog.");
    if (!normalizedSerial) errors.push("Serial number was not detected.");
    if (duplicate) errors.push("Serial number is duplicated inside the selected photos.");
    if (normalizedSerial && context.existingSerials?.has(normalizedSerial)) {
      errors.push("Serial number already exists in confirmed stock.");
    } else if (normalizedSerial && context.draftSerials?.has(normalizedSerial)) {
      warnings.push("Serial number also appears in another draft receipt.");
    }
    if (match.ambiguous) warnings.push("Product match is ambiguous; select the correct catalog product.");
    if (match.method === "fuzzy") warnings.push("Product was matched by label similarity; confirm the selection.");

    const ocrConfidence = extraction.ocr_confidence === null
      ? 0.7
      : Math.max(0, Math.min(1, extraction.ocr_confidence / 100));
    const serialConfidence = labeledSerials.length > 0 ? Math.max(0.7, ocrConfidence) : serial ? 0.92 : 0;
    const confidence = match.product
      ? Math.min(match.confidence, serialConfidence || match.confidence)
      : 0;
    if (confidence > 0 && confidence < 0.9) {
      warnings.push("Extraction confidence is below 90%; explicitly review this candidate.");
    }
    if (extraction.ocr_confidence !== null && extraction.ocr_confidence < 65) {
      warnings.push("OCR confidence is low; verify the label values.");
    }

    return {
      source_id: context.sourceId,
      candidate_index: index + 1,
      raw_product_name: productName,
      raw_sku: sku,
      raw_model: model,
      raw_serial: serial,
      raw_barcode: productBarcode || fallbackBarcodes[0] || "",
      product_id: match.product?.id || "",
      serial_number: serial,
      normalized_serial: normalizedSerial,
      unit_cost: match.product?.default_cost && match.product.default_cost > 0
        ? match.product.default_cost : null,
      planned_sale_price: match.product?.price && match.product.price > 0
        ? match.product.price : null,
      minimum_sale_price: match.product?.price && match.product.price > 0
        ? match.product.price : null,
      maximum_sale_price: match.product?.price && match.product.price > 0
        ? match.product.price : null,
      commission_type: match.product?.agent_commission_type || "none",
      commission_value: match.product?.agent_commission_value || 0,
      commission_base: "net_amount" as const,
      currency: context.defaultCurrency || "SAR",
      condition: "new",
      status: statusForCandidate(
        errors,
        warnings,
        duplicate || Boolean(normalizedSerial && context.existingSerials?.has(normalizedSerial)),
        !match.product
      ),
      confidence,
      match_method: match.method,
      validation_errors: errors,
      validation_warnings: warnings,
      save_as_alias: false,
    };
  });
}

export class LocalOcrProductExtractionProvider implements ProductExtractionProvider {
  async extract(file: File): Promise<ProductPhotoRawExtraction> {
    const [worker, { BrowserMultiFormatReader }] = await Promise.all([
      createLocalEnglishOcrWorker(),
      import("@zxing/browser"),
    ]);
    const url = URL.createObjectURL(file);
    try {
      const [ocr, barcode] = await Promise.all([
        worker.recognize(file, { rotateAuto: true }, { text: true, blocks: true }),
        new BrowserMultiFormatReader().decodeFromImageUrl(url).then(
          (result) => result.getText(),
          () => null
        ),
      ]);
      const boxes = (ocr.data.blocks ?? [])
        .flatMap((block) => block.paragraphs)
        .flatMap((paragraph) => paragraph.lines)
        .flatMap((line) => line.words)
        .slice(0, 300)
        .map((word) => ({
          text: word.text,
          confidence: word.confidence,
          x0: word.bbox.x0,
          y0: word.bbox.y0,
          x1: word.bbox.x1,
          y1: word.bbox.y1,
        }));
      return {
        raw_text: ocr.data.text || "",
        ocr_confidence: typeof ocr.data.confidence === "number" ? ocr.data.confidence : null,
        barcode_values: barcode ? [barcode] : [],
        bounding_boxes: boxes,
        engine: "tesseract-zxing-local",
        version: PRODUCT_PHOTO_EXTRACTION_VERSION,
      };
    } finally {
      URL.revokeObjectURL(url);
      await worker.terminate();
    }
  }
}

export async function enhanceProductPhotoForOcr(file: File) {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  const maxDimension = 2200;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.filter = "grayscale(100%) contrast(135%)";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92)
  );
  return blob
    ? new File([blob], `${file.name.replace(/\.[^.]+$/u, "") || "product-label"}-ocr.jpg`, { type: "image/jpeg" })
    : file;
}
