const express = require('express');
const multer = require('multer');
const path = require('path');
const { analyzeVideo } = require('../controllers/mainController');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ storage });

router.post('/', upload.single('video'), analyzeVideo);

module.exports = router;