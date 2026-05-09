# Use a lightweight Python image
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies required by spaCy
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download the English NLP model for spaCy
RUN python -m spacy download en_core_web_sm

# Copy application files
COPY . .

# Expose port
EXPOSE 8001

# Start the FastAPI app using Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
