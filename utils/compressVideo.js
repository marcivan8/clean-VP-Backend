const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const path = require("path");

ffmpeg.setFfmpegPath(ffmpegPath);

function extractAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo() // remove video track
      .audioCodec("libmp3lame") // MP3 format
      .audioBitrate("128k") // reduce bitrate for smaller file
      .format("mp3")
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err));
  });
}

module.exports = { extractAudio };
