FROM node:22-slim

# Install system deps for OCR + PDF
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-eng poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built files
COPY dist/ ./dist/
COPY .env.example ./

# Create data directory
RUN mkdir -p data/vault data/lancedb

# Default port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "fetch('http://localhost:3001/api/status').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Start
CMD ["node", "dist/index.js"]
