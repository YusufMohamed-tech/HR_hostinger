export const LOCAL_TESSERACT_ASSET_PATHS = {
  workerPath: "/ocr/tesseract/worker.min.js",
  corePath: "/ocr/tesseract/core",
  langPath: "/ocr/tesseract/lang",
} as const;

export async function createLocalEnglishOcrWorker() {
  const { createWorker, OEM } = await import("tesseract.js");
  return createWorker("eng", OEM.LSTM_ONLY, {
    ...LOCAL_TESSERACT_ASSET_PATHS,
    gzip: true,
    workerBlobURL: false,
  });
}

