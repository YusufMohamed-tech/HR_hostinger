import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const targetRoot = path.join(root, "public", "ocr", "tesseract");
const targetCore = path.join(targetRoot, "core");
const targetLang = path.join(targetRoot, "lang");

fs.mkdirSync(targetCore, { recursive: true });
fs.mkdirSync(targetLang, { recursive: true });

const assets = [
  [
    path.join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
    path.join(targetRoot, "worker.min.js"),
  ],
  ...[
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-lstm.wasm",
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm",
    "tesseract-core-relaxedsimd-lstm.wasm.js",
    "tesseract-core-relaxedsimd-lstm.wasm",
  ].map((filename) => [
    path.join(root, "node_modules", "tesseract.js-core", filename),
    path.join(targetCore, filename),
  ]),
  [
    path.join(
      root,
      "node_modules",
      "@tesseract.js-data",
      "eng",
      "4.0.0_best_int",
      "eng.traineddata.gz",
    ),
    path.join(targetLang, "eng.traineddata.gz"),
  ],
];

for (const [source, destination] of assets) {
  if (!fs.existsSync(source)) {
    throw new Error(`Required OCR asset is missing: ${path.relative(root, source)}`);
  }
  fs.copyFileSync(source, destination);
}

console.log(`Prepared ${assets.length} same-origin OCR assets.`);

