# WhatsApp BOT

> **v2.0.0** — TypeScript + Baileys ile geliştirilmiş, MVC mimarisine sahip profesyonel WhatsApp BOT API ve Chrome Addon.

<p align="center">
  <img src="public/logo.png" alt="WhatsApp BOT" width="120">
</p>

---

## 📑 İçindekiler

- [Özellikler](#-özellikler)
- [Mimari](#-mimari)
- [Kurulum](#-kurulum)
- [Ortam Değişkenleri](#-ortam-değişkenleri)
- [API Referansı](#-api-referansı)
- [Chrome Addon](#-chrome-addon--whatsapp-bot-manager)
- [Postman Collection](#-postman-collection)
- [Lisans](#-lisans)

---

## 🚀 Özellikler

| Kategori | Özellikler |
|----------|-----------|
| **Bağlantı** | QR veya telefon numarası (pairing kodu) ile oturum açma · Session persistence (PM2/restart sonrası otomatik bağlanma) · Otomatik arama reddi · Şifreleme hatası uyarısı + yeniden bağlanma |
| **Mesajlaşma** | Text, resim, video, ses, doküman gönderimi · Çoklu dosya (maks 5, her biri ≤2MB) sürükle-bırak · Otomatik typing göstergesi (ENV) |
| **Zamanlama** | İleri tarihe mesaj zamanlama · İki adımlı iptal→sil · Addon'da en erken +5 dk kontrolü |
| **Toplu Gönderim** | In-memory kuyruk sistemi · Numara doğrulama (geçersizleri ayıklama) · Rastgele gecikme (min/max) · Duraklat/Devam/İptal |
| **Güvenlik** | API Key auth · Rate limiting · CORS · Grup koruması · Request tracing (X-Request-ID) |
| **Gerçek Zamanlı** | SSE ile QR stream · Terminal log stream |
| **Addon** | Chrome Extension ile yönetim paneli — QR, gönderim, istatistik |

> **✅ Session Persistence:** PM2 veya sunucu restart sonrası WhatsApp oturumu korunur. Sadece `logout` endpoint'i ile oturum silinir.

---

## 🏗 Mimari

```
WhatsApp-BOT/
├── src/                          # Backend (TypeScript)
│   ├── app.ts                    # Ana uygulama başlatıcı
│   ├── server.ts                 # Express sunucu kurulumu
│   ├── config/
│   │   └── index.ts              # Ortam değişkenleri
│   ├── controllers/
│   │   ├── AuthController.ts     # Kimlik doğrulama & QR
│   │   ├── MessageController.ts  # Mesaj işlemleri & zamanlama
│   │   ├── BulkController.ts     # Toplu mesaj yönetimi
│   │   ├── SettingsController.ts # Uygulama ayarları
│   │   ├── StatsController.ts    # İstatistikler
│   │   └── TerminalController.ts # Terminal log stream
│   ├── services/                 # Tüm singleton'lar (getInstance + default export)
│   │   ├── WhatsAppService.ts    # Tek Baileys soketi: QR/pairing, reconnect, messageCache
│   │   ├── MessageService.ts     # Birleşik gönderim hattı (bağlantı bekleme + retry + typing)
│   │   ├── QueueService.ts       # Toplu gönderim kuyruğu (RAM)
│   │   ├── SchedulerService.ts   # Zamanlanmış mesaj motoru (RAM)
│   │   └── SettingsService.ts    # Çalışma-zamanı ayarları (.env'e yazar)
│   ├── middlewares/
│   │   ├── auth.ts               # X-API-Key doğrulama (boşsa wba_ otomatik üretir)
│   │   ├── connectionGuard.ts    # requireConnection — bağlı değilse 503
│   │   ├── errorHandler.ts       # Global hata yakalama + asyncHandler
│   │   └── rateLimiter.ts        # Rate limiting
│   ├── routes/
│   │   └── index.ts              # Tüm API rotaları
│   ├── types/
│   │   └── index.ts              # TypeScript tipleri
│   ├── views/
│   │   └── ResponseFormatter.ts  # Standart JSON response (her yanıt buradan)
│   └── utils/
│       ├── jid.ts                # formatJid / isGroupJid (ortak numara normalizasyonu)
│       └── logger.ts             # Pino logger + logEventBus (terminal SSE)
│
├── chrome-extension/             # Chrome Addon
│   ├── manifest.json             # Manifest V3
│   ├── popup.html                # Ana arayüz
│   ├── js/
│   │   ├── api.js                # API iletişim katmanı
│   │   ├── app.js                # Uygulama mantığı
│   │   └── utils.js              # Yardımcı fonksiyonlar
│   ├── styles/
│   │   └── main.css              # Dark tema stilleri
│   └── icons/                    # Extension ikonları
│
├── postman/                      # Postman Collection & Environment
└── public/                       # Statik dosyalar (auth_info oturumu, qr.png)
```

### İstek akışı & desenler

`routes → middlewares (auth + requireConnection) → controllers → services → WhatsAppService (Baileys soketi)`

- **Katman sorumluluğu:** Controller'lar yalnız HTTP (doğrulama + `ResponseFormatter`); tüm WhatsApp/durum mantığı servislerde. Soketi yalnız `WhatsAppService` çağırır.
- **Tek gönderim hattı:** Hem anlık hem zamanlı gönderim `MessageService.sendMessage()` üzerinden gider (bağlantı bekleme + yeniden deneme + otomatik "yazıyor"). "Yazıyor" süresi **daima** ENV `TYPING_DURATION`'dan gelir.
- **Singleton servisler:** `export default X.getInstance()` — `new` kullanılmaz, default import edilir.
- **"Mesaj bekleniyor" / retry:** `WhatsAppService.messageCache` (id→mesaj) reconnect'te SIFIRLANMAZ (yalnız logout'ta). Kısa sürede çok sayıda retry-receipt → `encryptionAlert` (→ `/auth/status`, çözüm `POST /auth/reconnect`).
- **Durum RAM'de:** Kuyruk/zamanlı mesajlar bellekte tutulur (DB yok) → restart'ta sıfırlanır. WhatsApp oturumu `public/auth_info`'da kalıcıdır.
- **Sohbet/inbox yok:** Gelen mesaj takibi/geçmiş kaldırıldı; `syncFullHistory:false` + `shouldSyncHistoryMessage:()=>false` (geçmiş senkronu kapalı).
- **NOTIFY:** `false` → cihaz offline işaretlenir, bildirim **telefona** gider; `true` → uygulama alır. Panelden değişince anında uygulanır.

> Daha fazla AI-ajan rehberi için bkz. **[AGENTS.md](AGENTS.md)**.

---

## 🛠 Kurulum

### Gereksinimler

- **Node.js** 18+
- **npm** veya **yarn**
- Chrome 88+ (Addon için)

### Backend

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme modunda çalıştır
npm run dev

# Watch modunda çalıştır (otomatik yeniden başlatma)
npm run dev:watch

# Production build & çalıştır
npm run build
npm start
```

### PM2 ile Production

```bash
npm run build
pm2 start dist/app.js --name whatsapp-bot
```

---

## ⚙️ Ortam Değişkenleri

Proje kök dizininde `.env` dosyası oluşturun:

```env
# Sunucu
PORT=3000
NODE_ENV=development
SESSION_PATH=./public/auth_info

# Saat dilimi (yalnızca .env'den yönetilir; tüm zamanlamalar/loglar bunu kullanır)
TZ=Europe/Istanbul

# WhatsApp Davranışı
AUTO_READ=true
# NOTIFY=false → cihaz offline görünür, bildirimler TELEFONA gider (önerilen)
# NOTIFY=true  → cihaz online, bildirimleri uygulama alır (telefon almaz)
NOTIFY=false
AUTO_REJECT_CALLS=true
# Mesaj öncesi "yazıyor..." süresi (ms). 0 = kapalı. Tekil/zamanlı gönderimde
# DAİMA bu değer kullanılır (istek gövdesindeki typingDuration yok sayılır).
TYPING_DURATION=4000

# Kuyruk
QUEUE_DELAY_MS=3000
QUEUE_MAX_RETRY=3

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# CORS (virgülle ayrılmış origin listesi veya * — chrome extension için * önerilir)
CORS_ORIGIN=*

# API Key (boş bırakılırsa wba_ önekli anahtar otomatik üretilir ve loglanır)
API_KEY=
```

---

## 📡 API Referansı

Tüm yanıtlar standart formatta döner:

**Başarılı yanıt:**

```json
{
  "success": true,
  "data": {},
  "message": "İşlem başarılı",
  "timestamp": "2026-02-25T12:00:00.000Z"
}
```

**Hata yanıtı:**

```json
{
  "success": false,
  "error": "Hata detayı",
  "message": "Hata mesajı",
  "timestamp": "2026-02-25T12:00:00.000Z"
}
```

### Kimlik Doğrulama

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `GET` | `/api/auth/qr` | QR kodu al (base64) |
| `GET` | `/api/auth/qr/image` | QR kodu PNG olarak al |
| `GET` | `/api/auth/qr/stream` | 🔴 SSE — QR akışı (real-time) |
| `POST` | `/api/auth/pairing-code` | Telefon numarası ile bağlanma kodu al (`{phoneNumber}`) |
| `GET` | `/api/auth/status` | Bağlantı durumu (+ `encryptionAlert`) |
| `POST` | `/api/auth/logout` | Oturumu kapat ve session'ı sil |
| `POST` | `/api/auth/cancel` | Bağlanma girişimini iptal et |
| `POST` | `/api/auth/reconnect` | Oturumu silmeden bağlantıyı yenile (şifreleme kurtarma) |

### Mesajlar

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `POST` | `/api/messages/send` | Mesaj gönder (text, image, video, audio, document) |
| `POST` | `/api/messages/typing/:jid` | Yazıyor göstergesi gönder |

### Zamanlanmış Mesajlar

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `POST` | `/api/messages/schedule` | Mesaj zamanla |
| `GET` | `/api/messages/scheduled` | Zamanlanmış mesajları listele |
| `GET` | `/api/messages/scheduled/:id` | Tekil detay |
| `PUT` | `/api/messages/scheduled/:id` | Düzenle |
| `POST` | `/api/messages/scheduled/:id/cancel` | Bekleyen mesajı iptal et (listede kalır) |
| `DELETE` | `/api/messages/scheduled/:id` | Listeden sil (bekleyen ise önce iptal gerekir) |
| `DELETE` | `/api/messages/scheduled/completed` | Tamamlanmışları temizle |

### Toplu Mesaj

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `POST` | `/api/bulk/send` | Toplu gönderim başlat |
| `GET` | `/api/bulk/jobs` | Tüm işler |
| `GET` | `/api/bulk/status/:jobId` | İş durumu |
| `GET` | `/api/bulk/status/:jobId/detailed` | Detaylı durum (alıcı bazlı) |
| `POST` | `/api/bulk/pause/:jobId` | Duraklat |
| `POST` | `/api/bulk/resume/:jobId` | Devam ettir |
| `POST` | `/api/bulk/cancel/:jobId` | İptal et |
| `DELETE` | `/api/bulk/job/:jobId` | İşi sil |
| `DELETE` | `/api/bulk/completed` | Tamamlananları temizle |

### SSE Streams (Gerçek Zamanlı)

| Endpoint | Açıklama |
|----------|----------|
| `/api/auth/qr/stream` | QR kod durumu (qr, connected, disconnected, timeout) |
| `/api/terminal/stream` | Terminal logları (real-time) |

### Ayarlar & İstatistikler

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `GET` | `/api/settings` | Tüm uygulama ayarlarını getir |
| `PUT` | `/api/settings` | Ayarları güncelle (anında geçerli) |
| `GET` | `/api/stats` | Tüm istatistikler (sistem, WhatsApp, kuyruk) |

---

## 📝 Kullanım Örnekleri

### Mesaj Gönderme

```bash
# Text mesaj (gönderim öncesi "yazıyor" süresi ENV TYPING_DURATION'dan gelir)
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{"jid": "905551234567", "message": "Merhaba!"}'

# Resim gönder (URL ile)
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "jid": "905551234567",
    "type": "image",
    "mediaUrl": "https://example.com/photo.jpg",
    "caption": "Fotoğraf açıklaması"
  }'

# Doküman gönder
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "jid": "905551234567",
    "type": "document",
    "mediaUrl": "https://example.com/rapor.pdf",
    "fileName": "rapor.pdf"
  }'
```

### Zamanlanmış Mesaj

```bash
# Mesaj zamanla
curl -X POST http://localhost:3000/api/messages/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "jid": "905551234567",
    "message": "Bu mesaj 2 saat sonra gönderilecek",
    "scheduledAt": "2026-02-25T14:00:00.000Z"
  }'

# Listele
curl http://localhost:3000/api/messages/scheduled

# İptal et
curl -X DELETE http://localhost:3000/api/messages/scheduled/MESSAGE_ID
```

### Toplu Mesaj

```bash
# Basit toplu gönderim
curl -X POST http://localhost:3000/api/bulk/send \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": ["905551111111", "905552222222", "905553333333"],
    "message": "Toplu mesaj!",
    "minDelay": 3000,
    "maxDelay": 10000
  }'

# İleri tarihli toplu gönderim
curl -X POST http://localhost:3000/api/bulk/send \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": ["905551111111", "905552222222"],
    "message": "İleri tarihte başlayacak",
    "minDelay": 5000,
    "maxDelay": 15000,
    "scheduledAt": "2026-02-26T09:00:00.000Z"
  }'

# Numara/profil kontrolü (WhatsApp hesabı var mı?)
curl -X POST http://localhost:3000/api/messages/validate \
  -H "Content-Type: application/json" \
  -d '{ "phones": ["905551111111", "905552222222"] }'
```

---

## 🧩 Chrome Addon — WhatsApp BOT Manager

Proje, tüm API özelliklerini görsel arayüzle kullanmanızı sağlayan bir **Chrome Extension** içerir.

### Addon Özellikleri

| Bölüm | Özellikler |
|-------|-----------|
| **Panel** | QR kod ile bağlanma · Sunucu ayarları (bildirim, otomatik okundu, arama reddi, yazıyor süresi — .env kaynaklı) · Sistem durumu · İstatistikler · Şifreleme hatası uyarısı + Yeniden Bağlan |
| **Gönderim** | Tekli mesaj (hemen veya zamanlı) · Toplu mesaj (gecikme, zaman penceresi, ileri tarih) · Text / Resim / Video / Doküman desteği · Aktif iş ve zamanlı mesaj takibi |

### Akıllı Navigasyon

- **API bağlantısı yoksa** → Sadece Panel sekmesi erişilebilir, diğerleri kilitli
- **WhatsApp bağlı değilse** → Gönderim kilitli, Panel'de QR ekranı görünür
- **Bağlı olduğunda** → Tüm sekmeler açılır, Panel'de dashboard görünür

### Addon Kurulumu

#### 1. Chrome'a Yükleme

1. Chrome'da `chrome://extensions` adresine gidin
2. **Geliştirici modu**nu açın (sağ üst)
3. **Paketlenmemiş öğe yükle** → `chrome-extension` klasörünü seçin
4. Yüklenen Extension'ın **ID**'sini kopyalayın

#### 2. API Bağlantısı

Extension API'ye erişmek için API Key kullanır. `.env` dosyasında `API_KEY` tanımlayın veya otomatik oluşturulan anahtarı kullanın.

#### 3. Addon'da API Bağlantısı

1. Extension ikonuna tıklayın → **Panel** sekmesi açılır
2. QR alanının altındaki **API Ayarları**'nı açın
3. API URL girin (varsayılan: `http://localhost:3000/api`)
4. Varsa API Key girin
5. **Test** → **Kaydet**

### Addon Kullanım Akışı

```
1. Addon'u aç → Panel sekmesi
2. API Ayarları → URL ve Key gir → Kaydet
3. "Bağlantıyı Başlat" → QR kodu tara
4. Bağlantı kuruldu → Gönderim aktif
5. Panel'den: Sunucu ayarları, istatistikler, hızlı işlemler
6. Gönderim'den: Tekli/toplu mesaj, zamanlı gönderim
```

### Addon Sorun Giderme

| Sorun | Çözüm |
|-------|-------|
| API bağlantısı kurulamadı | API sunucusunun çalıştığını ve URL'nin doğru olduğunu kontrol edin |
| CORS hatası | Extension ID'nin CORS whitelist'ine eklendiğinden emin olun |
| QR kod görünmüyor | "Bağlantıyı Başlat" butonuna tıklayın |
| Sekmeler kilitli | WhatsApp bağlantısının aktif olduğunu kontrol edin |
| Mesaj gönderilemiyor | Numara formatını kontrol edin (ör: `905551234567`) |

---

## ⏱ QR Kod Timeout

- **Maks QR denemesi**: 5 kez
- **Bağlantı timeout**: 2 dakika
- **QR süresi**: Her QR 60 saniye geçerli

QR taranmazsa bağlantı otomatik olarak durdurulur.

---

## 🔧 Teknolojiler

| Katman | Teknoloji |
|--------|-----------|
| Runtime | Node.js 18+ |
| Dil | TypeScript |
| Framework | Express.js |
| WhatsApp | Baileys (@whiskeysockets/baileys) |
| Logging | Pino |
| Güvenlik | Helmet · CORS · Rate Limiter |
| Addon | Chrome Extension (Manifest V3) |

---

## 📮 Postman Collection

```
postman/
├── WhatsApp-BOT-API.postman_collection.json          # Tüm API endpoint'leri
├── WhatsApp-BOT-Local.postman_environment.json       # Local ortam
└── WhatsApp-BOT-Production.postman_environment.json  # Production ortam
```

**İçe aktarma:** Postman → Import → `postman/` klasöründeki dosyaları sürükleyin → Environment seçin.

---

## 📜 Lisans

MIT
