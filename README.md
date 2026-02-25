# SERP Telegram Bot

VPS üzerinde çalışan, Serper.dev API ile Google Türkiye sıralama takibi yapan Telegram botu.

## Özellikler

- 🤖 Telegram Bot komutları
- 🔍 Serper.dev API entegrasyonu (Türkiye Google)
- ⏱️ Otomatik kontrol (cron)
- 💾 JSON tabanlı veri saklama
- 📝 Loglama
- 🔄 PM2 ile sürekli çalışma

## Hızlı Kurulum

```bash
# 1. Repoyu klonla
git clone https://github.com/LilboMaz/zaten.git
cd zaten

# 2. Bağımlılıkları yükle
npm install

# 3. .env dosyası oluştur
cat > .env << EOF
SERPER_API_KEY=your_serper_api_key
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
EOF

# 4. Botu başlat
npm start
```

## PM2 ile Sürekli Çalıştırma

```bash
# PM2 global kurulum
sudo npm install -g pm2

# Başlat
pm2 start server.js --name serp-bot

# Otomatik başlatma
pm2 startup
pm2 save

# Logları izle
pm2 logs serp-bot
```

## Telegram Komutları

| Komut | Açıklama | Örnek |
|-------|----------|-------|
| `/ekle` | Domain ve keyword ekle | `/ekle domain.com seo,web tasarım` |
| `/kontrol` | Sıralama kontrolü | `/kontrol domain.com` |
| `/listele` | Domainleri listele | `/listele` |
| `/sil` | Domain sil | `/sil domain.com` |
| `/aralik` | Kontrol aralığı (dk) | `/aralik 60` |
| `/otomatik` | Otomatik kontrol aç/kapat | `/otomatik aç` |
| `/durum` | Bot durumunu göster | `/durum` |

## Otomatik Kontrol

Bot, ayarlanan aralıkta (varsayılan 60 dk) tüm domainleri otomatik kontrol eder ve sonuçları Telegram grubuna gönderir.

Açma: `/otomatik aç`  
Kapatma: `/otomatik kapat`

## Dosya Yapısı

```
├── server.js          # Ana bot dosyası
├── package.json       # Bağımlılıklar
├── config.json        # Domain/keyword verisi (otomatik oluşur)
├── logs.txt           # İşlem logları (otomatik oluşur)
└── .env               # API anahtarları (sen oluştur)
```

## Gereksinimler

- Node.js 18+
- PM2 (sürekli çalıştırma için)
- Serper.dev API key
- Telegram Bot Token

## Güvenlik

`.env` dosyasını asla GitHub'a push etmeyin. `.gitignore`'a ekleyin.
