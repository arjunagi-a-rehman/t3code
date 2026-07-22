const MAX_BACKGROUND_IMAGE_DIMENSION = 2048;
const MAX_BACKGROUND_IMAGE_DATA_URL_LENGTH = 3_000_000;
const JPEG_ENCODE_QUALITIES = [0.85, 0.7, 0.55] as const;

export class BackgroundImageTooLargeError extends Error {
  constructor() {
    super("Image is too large to store as a background. Try a smaller image.");
    this.name = "BackgroundImageTooLargeError";
  }
}

export async function imageFileToBackgroundDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selected file is not an image.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      MAX_BACKGROUND_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable.");
    }
    context.drawImage(bitmap, 0, 0, width, height);

    const attempts: ReadonlyArray<{ type: string; quality?: number }> =
      file.type === "image/png"
        ? [
            { type: "image/png" },
            ...JPEG_ENCODE_QUALITIES.map((quality) => ({ type: "image/jpeg", quality })),
          ]
        : JPEG_ENCODE_QUALITIES.map((quality) => ({ type: "image/jpeg", quality }));

    for (const attempt of attempts) {
      const dataUrl = canvas.toDataURL(attempt.type, attempt.quality);
      if (dataUrl.length <= MAX_BACKGROUND_IMAGE_DATA_URL_LENGTH) {
        return dataUrl;
      }
    }

    throw new BackgroundImageTooLargeError();
  } finally {
    bitmap.close();
  }
}
