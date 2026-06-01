FROM python:3.11-slim

# Playwright uchun zarur Linux kutubxonalari
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libxkbcommon0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Python kutubxonalarini o'rnatish
RUN pip install --no-cache-dir -r requirements.txt

# Playwright brauzerini o'rnatish
RUN playwright install chromium

# Volume uchun papka yaratish
RUN mkdir -p /data /app/static

EXPOSE 8080

CMD python migrate.py && python main.py

