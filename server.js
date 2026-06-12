const express = require("express");
const cors = require("cors");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 5000;

// Dirs
const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "outputs");
[UPLOAD_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// CORS
app.use(cors({
  origin: 'https://status-fix-client.vercel.app',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// Multer — 50MB raw input limit
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|mp4|mov|avi|mkv|webm/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext || mime) cb(null, true);
    else cb(new Error("Unsupported file type"));
  },
});

// Cleanup helper
function cleanup(...files) {
  files.forEach((f) => {
    if (f && fs.existsSync(f)) {
      fs.unlink(f, (err) => {
        if (err) console.error("Cleanup error:", err.message);
      });
    }
  });
}

// ─── IMAGE PROCESSING ────────────────────────────────────────────────────────
function processImage(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-vf scale='min(1600,iw)':-2", // max 1600px wide, preserve ratio
        "-q:v 85",                       // JPEG quality (0-100 scale for ffmpeg)
      ])
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

// ─── VIDEO PROCESSING ────────────────────────────────────────────────────────
function processVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-vf scale='min(1280,iw)':-2",  // max 720p width
        "-crf 28",                        // quality (lower = better, 28 is good balance)
        "-preset fast",
        "-movflags +faststart",           // web-optimized MP4
        "-t 180",                         // cap at 3 minutes
        "-b:a 128k",                      // audio bitrate
      ])
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

// ─── MAIN ROUTE ──────────────────────────────────────────────────────────────
app.post("/process", upload.single("media"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const inputPath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  const isImage = /\.(jpg|jpeg|png)$/.test(ext);
  const isVideo = /\.(mp4|mov|avi|mkv|webm)$/.test(ext);

  if (!isImage && !isVideo) {
    cleanup(inputPath);
    return res.status(400).json({ error: "Unsupported file type." });
  }

  const outputExt = isImage ? ".jpg" : ".mp4";
  const outputFilename = `optimized-${Date.now()}${outputExt}`;
  const outputPath = path.join(OUTPUT_DIR, outputFilename);

  try {
    if (isImage) {
      await processImage(inputPath, outputPath);
    } else {
      await processVideo(inputPath, outputPath);
    }

    // Check output size
    const stats = fs.statSync(outputPath);
    const maxSize = isImage ? 5 * 1024 * 1024 : 16 * 1024 * 1024;

    if (stats.size > maxSize) {
      cleanup(inputPath, outputPath);
      return res.status(422).json({
        error: `Processed file still exceeds WhatsApp's ${isImage ? "5MB" : "16MB"} limit. Try a shorter/smaller file.`,
      });
    }

    // Send file
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="optimized_status${outputExt}"`
    );
    res.setHeader(
      "Content-Type",
      isImage ? "image/jpeg" : "video/mp4"
    );

    res.sendFile(outputPath, (err) => {
      cleanup(inputPath, outputPath);
      if (err && !res.headersSent) {
        console.error("Send error:", err.message);
      }
    });
  } catch (err) {
    console.error("FFmpeg error:", err.message);
    cleanup(inputPath, outputPath);
    res.status(500).json({ error: "Processing failed. Check your file and try again." });
  }
});

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`statusfix server running on port ${PORT}`));
