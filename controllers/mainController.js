const path = require("path");
const fs = require("fs");
const analyzeVideo = require("../utils/videoAnalyzer");

exports.analyze = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded." });
    }

    const videoPath = req.file.path;
    const { title, description } = req.body;

    console.log("Analyzing video:", videoPath);
    console.log("Title:", title);
    console.log("Description:", description);

    const results = await analyzeVideo(videoPath, title, description);

    // Optionally delete the uploaded video after analysis
    fs.unlink(videoPath, (err) => {
      if (err) console.warn("Failed to delete uploaded file:", err);
    });

    return res.json(results);

  } catch (error) {
    console.error("❌ Error during video analysis:", error.message || error);
    console.error(error.stack); // full error stack trace
    return res.status(500).json({ error: "Video analysis failed." });
  }
};
