#!/bin/bash
# SERP Tracker VPS Deploy Script
# Bu scripti VPS'de root olarak çalıştırın
# curl -fsSL https://raw.githubusercontent.com/.../deploy.sh | bash

set -e

echo "=========================================="
echo "SERP Tracker VPS Kurulum Scripti"
echo "=========================================="
echo ""

# Renkler
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Proje dizini
PROJECT_DIR="/opt/serp-tracker"

# 1. Sistem güncelleme
echo -e "${YELLOW}[1/8] Sistem güncelleniyor...${NC}"
apt update && apt upgrade -y

# 2. Gerekli paketleri kur
echo -e "${YELLOW}[2/8] Gerekli paketler kuruluyor...${NC}"
apt install -y nodejs npm git curl

# Node.js versiyon kontrolü
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${YELLOW}Node.js 18+ gerekiyor, güncelleniyor...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

echo -e "${GREEN}✓ Node.js $(node --version) kurulu${NC}"

# 3. PM2 kurulumu
echo -e "${YELLOW}[3/8] PM2 kuruluyor...${NC}"
npm install -g pm2

# 4. Proje dizini oluştur
echo -e "${YELLOW}[4/8] Proje dizini hazırlanıyor...${NC}"
if [ -d "$PROJECT_DIR" ]; then
    echo -e "${YELLOW}Mevcut proje yedekleniyor...${NC}"
    mv "$PROJECT_DIR" "${PROJECT_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
fi

mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# 5. Proje dosyalarını indir
echo -e "${YELLOW}[5/8] Proje dosyaları indiriliyor...${NC}"
# Git repo varsa clone yap, yoksa manuel kur
if command -v git &> /dev/null; then
    # Git ile klonla (repo URL'sini kullanıcıdan al)
    echo -e "${YELLOW}Git repo URL girin (veya Enter ile manuel kurulum):${NC}"
    read -r REPO_URL
    if [ -n "$REPO_URL" ]; then
        git clone "$REPO_URL" .
    else
        MANUAL_INSTALL=true
    fi
else
    MANUAL_INSTALL=true
fi

if [ "$MANUAL_INSTALL" = true ]; then
    echo -e "${YELLOW}Manuel kurulum: Dosyaları şu dizine yükleyin: $PROJECT_DIR${NC}"
    echo -e "${YELLOW}Gerekli dosyalar:${NC}"
    echo "  - server.js"
    echo "  - ecosystem.config.js"  
    echo "  - package.json"
    echo "  - .env"
    echo ""
    echo -e "${YELLOW}Dosyaları yükledikten sonra Enter'a basın...${NC}"
    read -r
fi

# 6. Bağımlılıkları yükle
echo -e "${YELLOW}[6/8] Bağımlılıklar yükleniyor...${NC}"
cd "$PROJECT_DIR"
npm install

# 7. Çevre değişkenleri kontrolü
echo -e "${YELLOW}[7/8] Çevre değişkenleri kontrol ediliyor...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${RED}.env dosyası bulunamadı!${NC}"
    echo -e "${YELLOW}.env dosyası oluşturuluyor...${NC}"
    
    cat > .env << 'EOF'
# Serper.dev API Key
SERPER_API_KEY=your_serper_api_key_here

# Telegram Bot Token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Telegram Chat ID
TELEGRAM_CHAT_ID=your_telegram_chat_id_here

# Port (opsiyonel)
PORT=3000
EOF

    echo -e "${RED}⚠️  LÜTFEN .env DOSYASINI DÜZENLEYİN:${NC}"
    echo "   nano $PROJECT_DIR/.env"
    echo ""
    echo -e "${YELLOW}API Anahtarlarınızı girin:${NC}"
    echo "  - SERPER_API_KEY: https://serper.dev/"
    echo "  - TELEGRAM_BOT_TOKEN: @BotFather"
    echo "  - TELEGRAM_CHAT_ID: @userinfobot"
    echo ""
    echo -e "${YELLOW}Düzenledikten sonra scripti tekrar çalıştırın.${NC}"
    exit 1
fi

# .env dosyasındaki placeholder kontrolü
if grep -q "your_.*_here" .env; then
    echo -e "${RED}⚠️  .env dosyasındaki placeholder değerleri değiştirilmemiş!${NC}"
    echo "   nano $PROJECT_DIR/.env"
    exit 1
fi

echo -e "${GREEN}✓ .env dosyası hazır${NC}"

# 8. PM2 ile başlat
echo -e "${YELLOW}[8/8] PM2 ile başlatılıyor...${NC}"
pm2 start ecosystem.config.js
pm2 save

# Otomatik başlatma ayarı
PM2_STARTUP=$(pm2 startup | grep "sudo" | tail -1)
if [ -n "$PM2_STARTUP" ]; then
    echo -e "${YELLOW}Otomatik başlatma ayarlanıyor...${NC}"
    eval "$PM2_STARTUP"
    pm2 save
fi

echo ""
echo "=========================================="
echo -e "${GREEN}✅ Kurulum Tamamlandı!${NC}"
echo "=========================================="
echo ""
echo "Bot Durumu:"
pm2 status

echo ""
echo "Logları izlemek için:"
echo "  pm2 logs serp-tracker"
echo ""
echo "Komutlar:"
echo "  /ekle domain.com kw1,kw2  - Domain ekle"
echo "  /kontrol domain.com        - Sıralama kontrol et"
echo "  /listele                   - Domainleri listele"
echo "  /durum                     - Bot durumu"
echo ""
echo "Dizin: $PROJECT_DIR"
echo "=========================================="
