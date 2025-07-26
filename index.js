const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "https://viral-pilot-production.up.railway.app", // frontend origin
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));

// other middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// your routes
app.use("/analyze", require("./routes/analyzeRoutes"));

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
