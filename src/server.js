import express from "express";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import mime from "mime-types";
import multer from "multer";

const app = express();
const port = Number(process.env.PORT || 3000);

// Configure multer for file uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (INPUT_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type. Allowed: ${Array.from(INPUT_EXTENSIONS).join(", ")}`))
    }
  }
});

// Function to get current image directory (allows runtime changes for testing)
function getImageDir() {
  return process.env.IMAGE_DIR || path.join(process.cwd(), "images");
}

const INPUT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".avif", ".gif", ".heic", ".heif"]);
const OUTPUT_FORMATS = new Set(["auto", "jpg", "jpeg", "png", "webp", "tiff", "avif"]);
const FIT_VALUES = new Set(["cover", "contain", "inside", "outside", "smart"]);

function isTrue(value) {
  return value === "true" || value === "1";
}

function toPositiveInt(value, name) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

function toQuality(value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw new Error("quality must be an integer between 1 and 100");
  }
  return n;
}

function pickOutputFormat(format, acceptHeader = "") {
  const normalized = (format || "auto").toLowerCase();
  if (!OUTPUT_FORMATS.has(normalized)) {
    throw new Error("format must be one of auto, jpg, png, webp, tiff");
  }

  if (normalized !== "auto") {
    return normalized === "jpeg" ? "jpg" : normalized;
  }

  const accept = acceptHeader.toLowerCase();
  if (accept.includes("image/avif")) return "avif";
  if (accept.includes("image/webp")) return "webp";
  return "jpg";
}

function pickFit(fit) {
  if (fit === undefined) return "cover";
  const normalized = fit.toLowerCase();
  if (!FIT_VALUES.has(normalized)) {
    throw new Error("fit must be one of cover, contain, inside, outside, smart");
  }
  return normalized;
}

function parseTransforms(transformsParam) {
  if (!transformsParam) return null;

  try {
    const transforms = typeof transformsParam === 'string'
      ? JSON.parse(transformsParam)
      : transformsParam;

    if (!Array.isArray(transforms)) {
      throw new Error("transforms must be an array");
    }

    return transforms;
  } catch (error) {
    throw new Error(`Invalid transforms parameter: ${error.message}`);
  }
}

function applyTransforms(pipeline, transforms) {
  if (!transforms || transforms.length === 0) return pipeline;

  for (const transform of transforms) {
    if (!Array.isArray(transform) || transform.length === 0) {
      throw new Error("Each transform must be a non-empty array [method, ...args]");
    }

    const [method, ...args] = transform;

    if (typeof method !== 'string') {
      throw new Error("Transform method name must be a string");
    }

    if (typeof pipeline[method] !== 'function') {
      throw new Error(`Invalid Sharp method: ${method}`);
    }

    // Apply the transformation
    pipeline = pipeline[method](...args);
  }

  return pipeline;
}

function collectImages(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (INPUT_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  return files;
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Shared function to process image from buffer or file path
async function processImage(imageInput, query, acceptHeader = "", originalFilename = null) {
  const width = toPositiveInt(query.width, "width");
  const height = toPositiveInt(query.height, "height");
  const quality = toQuality(query.quality);
  const withoutEnlargement = isTrue(query.withoutEnlargement);
  const fit = pickFit(query.fit);
  const outputFormat = query.format ? pickOutputFormat(query.format, acceptHeader) : null;
  const transforms = parseTransforms(query.transforms);
  const background = query.background;

  if (background !== undefined && background !== "blur") {
    throw new Error("background must be blur");
  }

  // If no transformation parameters are provided, return the original image
  if (
    width === undefined &&
    height === undefined &&
    !outputFormat &&
    quality === undefined &&
    !transforms &&
    background === undefined
  ) {
    let imageBuffer;
    let mimeType;

    if (Buffer.isBuffer(imageInput)) {
      imageBuffer = imageInput;

      if (originalFilename) {
        const ext = path.extname(originalFilename).toLowerCase();
        mimeType = mime.lookup(ext) || "application/octet-stream";
      } else {
        mimeType = "application/octet-stream";
      }
    } else {
      imageBuffer = fs.readFileSync(imageInput);
      mimeType = mime.lookup(path.extname(imageInput)) || "application/octet-stream";
    }

    return { buffer: imageBuffer, mimeType };
  }

  // Read metadata for smart fitting
  let resizeFit = fit;
  let useBlurBackground = false;

  if (
    fit === "smart" &&
    width !== undefined &&
    height !== undefined
  ) {
    const metadata = await sharp(imageInput, { failOn: "none" }).metadata();

    let imageWidth = metadata.width;
    let imageHeight = metadata.height;

    // EXIF orientations 5-8 rotate the image by 90 degrees
    if (metadata.orientation >= 5 && metadata.orientation <= 8) {
      [imageWidth, imageHeight] = [imageHeight, imageWidth];
    }

    if (imageWidth && imageHeight) {
      const imageAspect = imageWidth / imageHeight;
      const targetAspect = width / height;

      if (imageAspect >= targetAspect) {
        // Landscape / wider than target
        resizeFit = "contain";
      } else {
        // Portrait / narrower than target
        resizeFit = "contain";

        if (background === "blur") {
          useBlurBackground = true;
        }
      }
    } else {
      resizeFit = "contain";
    }
  }

  /*
   * Special case:
   *
   * fit=smart + background=blur + portrait image
   *
   * Create a blurred, cover-fitted copy of the image as the background,
   * then place the complete image on top using contain.
   */
  if (useBlurBackground) {
    // Background
    let backgroundPipeline = sharp(imageInput, { failOn: "none" })
      .rotate()
      .resize({
        width,
        height,
        fit: "cover"
      })
      .blur(30);

    // Foreground
    let foregroundPipeline = sharp(imageInput, { failOn: "none" })
      .rotate()
      .resize({
        width,
        height,
        fit: "contain",
        withoutEnlargement
      });

    // Apply custom transforms to foreground only
    if (transforms) {
      foregroundPipeline = applyTransforms(foregroundPipeline, transforms);
    }

    const backgroundBuffer = await backgroundPipeline
      .jpeg({ quality: 90 })
      .toBuffer();

    const foregroundBuffer = await foregroundPipeline
      .png()
      .toBuffer();

    let compositePipeline = sharp(backgroundBuffer)
      .composite([
        {
          input: foregroundBuffer,
          gravity: "center"
        }
      ]);

    const finalFormat = outputFormat || pickOutputFormat("auto", acceptHeader);

    if (finalFormat === "jpg") {
      compositePipeline = compositePipeline.jpeg(
        quality !== undefined ? { quality } : {}
      );
    } else if (finalFormat === "png") {
      compositePipeline = compositePipeline.png(
        quality !== undefined ? { quality } : {}
      );
    } else if (finalFormat === "webp") {
      compositePipeline = compositePipeline.webp(
        quality !== undefined ? { quality } : {}
      );
    } else if (finalFormat === "tiff") {
      compositePipeline = compositePipeline.tiff(
        quality !== undefined ? { quality } : {}
      );
    } else if (finalFormat === "avif") {
      compositePipeline = compositePipeline.avif(
        quality !== undefined ? { quality } : {}
      );
    }

    const output = await compositePipeline.toBuffer();

    const mimeType =
      mime.lookup(finalFormat === "jpg" ? "jpeg" : finalFormat) ||
      "application/octet-stream";

    return {
      buffer: output,
      mimeType
    };
  }

  // Normal processing
  let pipeline = sharp(imageInput, { failOn: "none" });

  // Auto-orient based on EXIF data if no custom rotate transform is provided
  const hasRotateTransform =
    transforms && transforms.some(t => t[0] === "rotate");

  if (!hasRotateTransform) {
    pipeline = pipeline.rotate();
  }

  // Only resize if width or height is specified
  if (width !== undefined || height !== undefined) {
    pipeline = pipeline.resize({
      width,
      height,
      fit: resizeFit,
      withoutEnlargement
    });
  }

  // Apply custom transforms if provided
  if (transforms) {
    pipeline = applyTransforms(pipeline, transforms);
  }

  // Apply output format if specified
  const finalFormat =
    outputFormat || pickOutputFormat("auto", acceptHeader);

  if (finalFormat === "jpg") {
    pipeline = pipeline.jpeg(
      quality !== undefined ? { quality } : {}
    );
  } else if (finalFormat === "png") {
    pipeline = pipeline.png(
      quality !== undefined ? { quality } : {}
    );
  } else if (finalFormat === "webp") {
    pipeline = pipeline.webp(
      quality !== undefined ? { quality } : {}
    );
  } else if (finalFormat === "tiff") {
    pipeline = pipeline.tiff(
      quality !== undefined ? { quality } : {}
    );
  } else if (finalFormat === "avif") {
    pipeline = pipeline.avif(
      quality !== undefined ? { quality } : {}
    );
  }

  const output = await pipeline.toBuffer();

  const mimeType =
    mime.lookup(finalFormat === "jpg" ? "jpeg" : finalFormat) ||
    "application/octet-stream";

  return {
    buffer: output,
    mimeType
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, imageDir: getImageDir() });
});

app.post("/transform-image", upload.single("image"), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded. Use 'image' as the form field name." });
    }

    // Process the uploaded image buffer
    const { buffer, mimeType } = await processImage(
      req.file.buffer,
      req.query,
      req.headers.accept || "",
      req.file.originalname
    );

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (error) {
    res.status(400).json({ error: error.message || "Bad request" });
  }
});

app.get("/random-image", async (req, res) => {
  try {
    const images = collectImages(getImageDir());
    if (images.length === 0) {
      return res.status(404).json({
        error: `No images found in IMAGE_DIR: ${getImageDir()}`
      });
    }

    const file = randomItem(images);

    // Process the randomly selected image file
    const { buffer, mimeType } = await processImage(file, req.query, req.headers.accept || "");

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (error) {
    res.status(400).json({ error: error.message || "Bad request" });
  }
});

// Only start server if this file is run directly (not imported for testing)
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('server.js') ||
  process.argv[1].endsWith('server.mjs')
);

if (isMainModule) {
  app.listen(port, () => {
    console.log(`randomx-image listening on port ${port}`);
    console.log(`using image dir: ${getImageDir()}`);
  });
}

export default app;
