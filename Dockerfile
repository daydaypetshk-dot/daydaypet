FROM node:22-bullseye-slim

# 安裝 Puppeteer 及 Chrome 所需的系統依賴
RUN apt-get update && apt-get install -y --no-install-recommends \
  wget \
  gnupg \
  tar \
  unzip \
  libasound2 \
  libatk-bridge2.0-0 \
  libgtk-3-0 \
  libgbm-dev \
  libnss3 \
  libxss1 \
  fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV WHATSAPP_SERVICE_PORT=3001

EXPOSE 3001

CMD ["node", "whatsapp-service.js"]
