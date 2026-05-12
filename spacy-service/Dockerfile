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

# Internal Railway service — always listens on 8001
# The backend reaches it via: http://spacy-service.railway.internal:8001
EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
