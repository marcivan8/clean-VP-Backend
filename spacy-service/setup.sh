#!/bin/bash
# Setup script for the spaCy NLP microservice
set -e

echo "📦 Installing Python dependencies..."
pip install -r requirements.txt

echo "📥 Downloading spaCy English model..."
python -m spacy download en_core_web_sm

echo "✅ Setup complete! Run with: uvicorn main:app --host 0.0.0.0 --port 8001 --reload"
