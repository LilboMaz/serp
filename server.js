require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

const app = express();
app.use(express.json());

const CONFIG_FILE = path.join(__dirname, 'config.json');
const LOG_FILE = path.join(__dirname, 'logs.txt');

// ==================== CONFIG YÖNETİMİ ====================

async function readConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { 
      domains: [], 
      settings: { 
        autoCheck: true, 
        intervalMinutes: 60,
        notifyOnChangeOnly: false 
      } 
    };
  }
}

async function writeConfig(config) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

async function log(message) {
  const timestamp = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const line = `[${timestamp}] ${message}\n`;
  console.log(line.trim());
  await fs.appendFile(LOG_FILE, line, 'utf-8').catch(() => {});
}

// ==================== SERPER API ====================

async function checkDomain(domain, keywords) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('SERPER_API_KEY tanımlı değil');

  const cleanDomain = domain
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase();
  
  const results = [];

  for (const keyword of keywords) {
    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: keyword.trim(),
          gl: 'tr',
          hl: 'tr',
          num: 100,
        }),
      });

      if (!response.ok) {
        results.push({ 
          keyword: keyword.trim(), 
          position: null, 
          error: `HTTP ${response.status}` 
        });
        continue;
      }

      const data = await response.json();
      const organic = data.organic || [];

      let found = false;
      for (const item of organic) {
        const itemDomain = item.link
          .replace(/^https?:\/\//, '')
          .replace(/\/$/, '')
          .toLowerCase();
        
        // Tam eşleşme veya subdomain kontrolü (daha sıkı)
        const isMatch = itemDomain === cleanDomain || 
          itemDomain === 'www.' + cleanDomain ||
          itemDomain.startsWith(cleanDomain + '/') ||
          itemDomain.startsWith('www.' + cleanDomain + '/');
        
        if (isMatch) {
          results.push({
            keyword: keyword.trim(),
            position: item.position,
            url: item.link,
            title: item.title,
          });
          found = true;
          break;
        }
      }

      if (!found) {
        results.push({ 
          keyword: keyword.trim(), 
          position: null, 
          error: 'İlk 100\'de yok' 
        });
      }
    } catch (err) {
      results.push({ 
        keyword: keyword.trim(), 
        position: null, 
        error: err.message 
      });
    }
  }

  return results;
}

// ==================== TELEGRAM BOT ====================

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// /start - Yardım
bot.start((ctx) => {
  const helpText = `🤖 *SERP Tracker Bot*\n\n` +
    `Türkiye Google sıralamasını takip eder.\n\n` +
    `*Komutlar:*\n` +
    `📌 /ekle domain.com kw1,kw2,kw3\n` +
    `   → Domain ve keyword ekle\n\n` +
    `🔍 /kontrol domain.com\n` +
    `   → Sıralama kontrol et\n\n` +
    `📋 /listele\n` +
    `   → Tüm domainleri listele\n\n` +
    `🗑 /sil domain.com\n` +
    `   → Domain sil\n\n` +
    `⏱ /aralik 60\n` +
    `   → Otomatik kontrol dakikası (10-1440)\n\n` +
    `🔄 /otomatik aç/kapat\n` +
    `   → Otomatik kontrol aç/kapat\n\n` +
    `📊 /durum\n` +
    `   → Bot durumunu göster`;
  
  ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// /ekle - Domain ve keyword ekle
bot.command('ekle', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  
  if (parts.length < 3) {
    return ctx.reply(
      '❌ *Kullanım:* /ekle domain.com kw1,kw2,kw3\n\n' +
      'Örnek: /ekle example.com seo,web tasarım,digital pazarlama',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = parts[1].toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const keywordsText = parts.slice(2).join(' ');
  const keywords = keywordsText
    .split(/[,，]/)
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 0);

  if (!domain || keywords.length === 0) {
    return ctx.reply('❌ Domain ve en az bir keyword gerekli');
  }

  const config = await readConfig();
  const existing = config.domains.find(d => d.domain === domain);
  
  if (existing) {
    // Mevcut domain'e yeni keyword'ler ekle
    const newKeywords = keywords.filter(k => !existing.keywords.includes(k));
    existing.keywords = [...existing.keywords, ...newKeywords];
    existing.lastUpdated = new Date().toISOString();
    
    await writeConfig(config);
    await log(`Domain güncellendi: ${domain} (+${newKeywords.length} keyword)`);
    
    ctx.reply(
      `✅ *${domain}* güncellendi!\n\n` +
      `🔑 Toplam: ${existing.keywords.length} keyword\n` +
      `➕ Yeni: ${newKeywords.length} keyword`,
      { parse_mode: 'Markdown' }
    );
  } else {
    // Yeni domain ekle
    config.domains.push({
      domain,
      keywords,
      addedAt: new Date().toISOString(),
      lastChecked: null,
      checkCount: 0
    });
    
    await writeConfig(config);
    await log(`Domain eklendi: ${domain} (${keywords.length} keyword)`);
    
    ctx.reply(
      `✅ *${domain}* eklendi!\n\n` +
      `🔑 ${keywords.length} keyword\n` +
      `🔄 Otomatik kontrole dahil edildi`,
      { parse_mode: 'Markdown' }
    );
  }
});

// /kontrol - Sıralama kontrolü (tüm domainler veya tek domain)
bot.command('kontrol', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const config = await readConfig();
  
  if (config.domains.length === 0) {
    return ctx.reply('❌ Önce /ekle ile domain ekle');
  }

  // Domain belirtilmemişse TÜM domainleri kontrol et
  const checkAll = parts.length < 2;
  
  const domainsToCheck = checkAll 
    ? config.domains 
    : [config.domains.find(d => d.domain === parts[1].toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, ''))].filter(Boolean);

  if (domainsToCheck.length === 0) {
    return ctx.reply(`❌ Domain bulunamadı. /listele ile kayıtlı domainleri görebilirsin.`);
  }

  const msg = await ctx.reply(
    checkAll 
      ? `⏳ Tüm domainler (${domainsToCheck.length}) kontrol ediliyor...` 
      : `⏳ *${domainsToCheck[0].domain}* sorgulanıyor...`, 
    { parse_mode: 'Markdown' }
  );
  
  let allResults = [];
  
  for (const domainConfig of domainsToCheck) {
    try {
      await log(`Kontrol başladı: ${domainConfig.domain}`);
      const results = await checkDomain(domainConfig.domain, domainConfig.keywords);
      
      let text = `🔍 *${domainConfig.domain}*\n`;
      
      let found = 0;
      results.forEach(r => {
        if (r.position) {
          const emoji = r.position <= 3 ? '🥇' : r.position <= 10 ? '🔵' : '⚪';
          text += `${emoji} *${r.keyword}*: #${r.position}\n`;
          found++;
        } else {
          text += `❌ *${r.keyword}*: ${r.error}\n`;
        }
      });
      
      text += `\n📊 ${found}/${results.length} bulundu`;
      allResults.push({ domain: domainConfig.domain, text, found, total: results.length });
      
      // Domain istatistiklerini güncelle
      domainConfig.lastChecked = new Date().toISOString();
      domainConfig.checkCount = (domainConfig.checkCount || 0) + 1;
      
      // Rate limit koruması
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      allResults.push({ domain: domainConfig.domain, text: `❌ Hata: ${err.message}`, found: 0, total: 0 });
    }
  }
  
  await writeConfig(config);
  
  // Sonuçları birleştir
  let finalText = checkAll 
    ? `📊 *Tüm Domain Kontrolü*\n\n` 
    : `🔍 *Kontrol Sonuçları*\n\n`;
  
  allResults.forEach(r => {
    finalText += `━━━ ${r.domain} ━━━\n${r.text}\n\n`;
  });
  
  await ctx.telegram.editMessageText(
    ctx.chat.id, 
    msg.message_id, 
    undefined, 
    finalText, 
    { parse_mode: 'Markdown' }
  );
  
  await log(`Kontrol tamamlandı: ${allResults.length} domain`);
});

// /listele - Tüm domainleri listele
bot.command('listele', async (ctx) => {
  const config = await readConfig();
  
  if (config.domains.length === 0) {
    return ctx.reply('📭 Kayıtlı domain yok.\n\n/ekle domain.com kw1,kw2');
  }

  let text = '📋 *Kayıtlı Domainler*\n\n';
  
  config.domains.forEach((d, i) => {
    const lastCheck = d.lastChecked 
      ? new Date(d.lastChecked).toLocaleString('tr-TR', { 
          timeZone: 'Europe/Istanbul',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'Hiç kontrol edilmedi';
    
    text += `${i + 1}. \`${d.domain}\`\n`;
    text += `   🔑 ${d.keywords.length} keyword | 🔄 ${d.checkCount || 0} kontrol\n`;
    text += `   🕐 ${lastCheck}\n\n`;
  });
  
  text += `Toplam: ${config.domains.length} domain`;
  
  ctx.reply(text, { parse_mode: 'Markdown' });
});

// /sil - Domain sil
bot.command('sil', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  
  if (parts.length < 2) {
    return ctx.reply('❌ *Kullanım:* /sil domain.com', { parse_mode: 'Markdown' });
  }
  
  const domain = parts[1].toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const config = await readConfig();
  const idx = config.domains.findIndex(d => d.domain === domain);
  
  if (idx === -1) {
    return ctx.reply(`❌ *${domain}* bulunamadı`, { parse_mode: 'Markdown' });
  }
  
  config.domains.splice(idx, 1);
  await writeConfig(config);
  await log(`Domain silindi: ${domain}`);
  
  ctx.reply(`✅ *${domain}* silindi`, { parse_mode: 'Markdown' });
});

// /aralik - Kontrol aralığını ayarla
bot.command('aralik', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const config = await readConfig();
  
  if (parts.length < 2) {
    return ctx.reply(
      `⏱ *Şu anki aralık:* ${config.settings.intervalMinutes} dakika\n\n` +
      `*Kullanım:* /aralik 60\n` +
      `(10-1440 dakika arası)`,
      { parse_mode: 'Markdown' }
    );
  }
  
  const minutes = parseInt(parts[1]);
  
  if (isNaN(minutes) || minutes < 10 || minutes > 1440) {
    return ctx.reply('❌ 10-1440 dakika arası bir değer girin\nÖrnek: /aralik 60');
  }
  
  config.settings.intervalMinutes = minutes;
  await writeConfig(config);
  
  // Cron'u yeniden başlat
  setupCron();
  
  await log(`Kontrol aralığı değiştirildi: ${minutes} dakika`);
  ctx.reply(`✅ Kontrol aralığı *${minutes} dakika* olarak ayarlandı`, { parse_mode: 'Markdown' });
});

// /otomatik - Otomatik kontrol aç/kapat
bot.command('otomatik', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const config = await readConfig();
  
  let newState;
  
  if (parts.length >= 2) {
    const param = parts[1].toLowerCase();
    if (param === 'aç' || param === 'ac') newState = true;
    else if (param === 'kapat') newState = false;
    else {
      return ctx.reply('❌ *Kullanım:* /otomatik aç veya /otomatik kapat', { parse_mode: 'Markdown' });
    }
  } else {
    // Toggle
    newState = !config.settings.autoCheck;
  }
  
  config.settings.autoCheck = newState;
  await writeConfig(config);
  
  // Cron'u yeniden başlat
  setupCron();
  
  const status = newState ? '🟢 AÇIK' : '🔴 KAPALI';
  await log(`Otomatik kontrol: ${status}`);
  
  ctx.reply(
    `🔄 Otomatik kontrol: *${status}*\n\n` +
    `Aralık: ${config.settings.intervalMinutes} dakika`,
    { parse_mode: 'Markdown' }
  );
});

// /durum - Bot durumu
bot.command('durum', async (ctx) => {
  const config = await readConfig();
  const status = config.settings.autoCheck ? '🟢 Açık' : '🔴 Kapalı';
  
  const totalKeywords = config.domains.reduce((sum, d) => sum + d.keywords.length, 0);
  
  let text = '📊 *Bot Durumu*\n\n';
  text += `🔄 Otomatik Kontrol: ${status}\n`;
  text += `⏱ Kontrol Aralığı: ${config.settings.intervalMinutes} dakika\n`;
  text += `📁 Domain Sayısı: ${config.domains.length}\n`;
  text += `🔑 Toplam Keyword: ${totalKeywords}\n\n`;
  
  if (config.domains.length > 0) {
    text += `*Domainler:*\n`;
    config.domains.forEach(d => {
      text += `• ${d.domain} (${d.keywords.length} kw)\n`;
    });
  }
  
  ctx.reply(text, { parse_mode: 'Markdown' });
});

// Hata yakalama
bot.catch((err, ctx) => {
  log(`Bot hatası: ${err.message}`);
  console.error('Bot error:', err);
});

// ==================== OTOMATİK KONTROL (CRON) ====================

let cronTask = null;

async function runAutoCheck() {
  const config = await readConfig();
  
  if (!config.settings.autoCheck || config.domains.length === 0) {
    return;
  }

  await log('=== Otomatik kontrol başladı ===');

  for (const domainConfig of config.domains) {
    try {
      await log(`Otomatik: ${domainConfig.domain} kontrol ediliyor...`);
      const results = await checkDomain(domainConfig.domain, domainConfig.keywords);
      const found = results.filter(r => r.position).length;
      
      let text = `🔄 *Otomatik Rapor*\n`;
      text += `🌐 ${domainConfig.domain}\n`;
      text += `🇹🇷 Türkiye - Google\n\n`;
      
      results.forEach(r => {
        if (r.position) {
          const emoji = r.position <= 3 ? '🥇' : r.position <= 10 ? '🔵' : '⚪';
          text += `${emoji} *${r.keyword}* → #${r.position}\n`;
        } else {
          text += `❌ *${r.keyword}* → ${r.error}\n`;
        }
      });
      
      text += `\n📊 ${found}/${results.length} keyword bulundu`;

      await bot.telegram.sendMessage(
        process.env.TELEGRAM_CHAT_ID, 
        text, 
        { parse_mode: 'Markdown' }
      );
      
      // Domain istatistiklerini güncelle
      domainConfig.lastChecked = new Date().toISOString();
      domainConfig.checkCount = (domainConfig.checkCount || 0) + 1;
      await writeConfig(config);
      
      await log(`Otomatik: ${domainConfig.domain} - ${found}/${results.length} bulundu`);
      
      // Rate limit koruması - domainler arası bekleme
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      await log(`Hata ${domainConfig.domain}: ${err.message}`);
      await bot.telegram.sendMessage(
        process.env.TELEGRAM_CHAT_ID,
        `⚠️ *Hata:* ${domainConfig.domain} kontrol edilemedi\n${err.message}`,
        { parse_mode: 'Markdown' }
      );
    }
  }
  
  await log('=== Otomatik kontrol tamamlandı ===');
}

function setupCron() {
  // Mevcut cron'u durdur
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    log('Eski cron durduruldu');
  }

  readConfig().then(config => {
    if (config.settings.autoCheck) {
      const interval = Math.min(Math.max(config.settings.intervalMinutes, 10), 1440);
      
      // Dakika cinsinden cron expression
      // Her X dakikada çalışır
      cronTask = cron.schedule(`*/${interval} * * * *`, runAutoCheck);
      
      log(`Cron ayarlandı: Her ${interval} dakikada bir`);
    } else {
      log('Otomatik kontrol kapalı');
    }
  });
}

// ==================== BAŞLANGIÇ ====================

async function start() {
  await log('========================================');
  await log('SERP Tracker Bot başlatılıyor...');
  await log('========================================');
  
  // Config kontrolü
  const config = await readConfig();
  await log(`Yüklenen domain: ${config.domains.length}`);
  await log(`Otomatik kontrol: ${config.settings.autoCheck ? 'Açık' : 'Kapalı'}`);
  await log(`Kontrol aralığı: ${config.settings.intervalMinutes} dakika`);
  
  // Cron'u başlat
  setupCron();
  
  // Express health check
  app.get('/', (req, res) => {
    res.json({ 
      status: 'OK', 
      bot: 'running',
      timestamp: new Date().toISOString()
    });
  });
  
  app.get('/health', (req, res) => {
    res.json({ 
      healthy: true,
      uptime: process.uptime(),
      domains: config.domains.length
    });
  });
  
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    log(`HTTP server ${PORT} portunda`);
  });

  // Bot polling
  bot.launch();
  log('Telegram bot başlatıldı');
  log('========================================');
}

start().catch(err => {
  log(`Başlangıç hatası: ${err.message}`);
  console.error(err);
  process.exit(1);
});

// Graceful shutdown
process.once('SIGINT', () => {
  log('SIGINT alındı, kapatılıyor...');
  bot.stop('SIGINT');
  if (cronTask) cronTask.stop();
  process.exit(0);
});

process.once('SIGTERM', () => {
  log('SIGTERM alındı, kapatılıyor...');
  bot.stop('SIGTERM');
  if (cronTask) cronTask.stop();
  process.exit(0);
});
