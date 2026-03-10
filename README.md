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
| **Bağlantı** | QR ile oturum açma (SSE real-time) · Session persistence (PM2/restart sonrası otomatik bağlanma) · Otomatik arama reddi |
| **Mesajlaşma** | Text, resim, video, ses, doküman gönderimi · Otomatik typing göstergesi · Mesaj geçmişi (session boyunca) |
| **Zamanlama** | İleri tarihe mesaj zamanlama · Düzenleme ve iptal · Minimum 30 sn ileri zaman kontrolü |
| **Toplu Gönderim** | In-memory kuyruk sistemi · Rastgele gecikme (min/max) · Zaman penceresi (ör: 09:00–18:00) · Duraklat/Devam/İptal |
| **Sohbet** | Filtreleme (okunmamış, arşivli, ülke kodu) · Arama · Arşivleme, sabitleme, sessize alma |
| **Güvenlik** | API Key auth · Rate limiting · CORS whitelist · Grup koruması · Request tracing (X-Request-ID) |
| **Gerçek Zamanlı** | SSE ile QR stream · SSE ile mesaj stream · Terminal log stream |
| **Addon** | Chrome Extension ile tam yönetim paneli — QR, sohbet, gönderim, istatistik |

> **⚠️ Not:** Mesaj geçmişi oturum süresince bellekte tutulur. Uygulama yeniden başlatıldığında geçmiş sıfırlanır, yeni mesajlar tekrar kaydedilir.

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
│   ├── services/
│   │   ├── WhatsAppService.ts    # Baileys entegrasyonu
│   │   ├── MessageService.ts     # Mesaj servisi & geçmiş
│   │   ├── QueueService.ts       # Toplu gönderim kuyruğu
│   │   ├── SchedulerService.ts   # Zamanlanmış mesaj motoru
│   │   └── SettingsService.ts    # Ayar yönetimi
│   ├── middlewares/
│   │   ├── auth.ts               # API Key doğrulama
│   │   ├── connectionGuard.ts    # WhatsApp bağlantı kontrolü
│   │   ├── errorHandler.ts       # Global hata yakalama
│   │   ├── rateLimiter.ts        # Rate limiting
│   │   └── sseGuard.ts           # SSE CORS kontrolü
│   ├── routes/
│   │   └── index.ts              # Tüm API rotaları
│   ├── types/
│   │   └── index.ts              # TypeScript tipleri
│   ├── views/
│   │   └── ResponseFormatter.ts  # Standart JSON response
│   └── utils/
│       └── logger.ts             # Pino logger
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
└── public/                       # Statik dosyalar
```

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

# Saat dilimi (tüm zamanlamalar ve loglar bu dilimi kullanır)
TZ=Europe/Istanbul

# WhatsApp Davranışı
AUTO_READ=true
NOTIFY=false
AUTO_REJECT_CALLS=true

# Kuyruk
QUEUE_DELAY_MS=3000
QUEUE_MAX_RETRY=3

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# CORS Whitelist
CORS_WHITE_LIST="::1, ::ffff:127.0.0.1"

# API Key (boş bırakılırsa otomatik oluşturulur)
API_KEY=

# Otomatik Önbellek Temizleme (dakika, 0 = kapalı)
CACHE_CLEAR_INTERVAL=0
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
| `GET` | `/api/auth/status` | Bağlantı durumu |
| `POST` | `/api/auth/logout` | Oturumu kapat ve session'ı sil |
| `POST` | `/api/auth/cancel` | Bağlanma girişimini iptal et |

### Mesajlar

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `POST` | `/api/messages/send` | Mesaj gönder (text, image, video, audio, document) |
| `GET` | `/api/messages/chats` | Sohbet listesi (filtreleme + sayfalama) |
| `GET` | `/api/messages/history/:jid` | Mesaj geçmişi |
| `GET` | `/api/messages/stats` | Sohbet istatistikleri |
| `GET` | `/api/messages/check/:phone` | Numara WhatsApp'ta kayıtlı mı? |
| `GET` | `/api/messages/profile/:jid` | Profil bilgisi |

### Sohbet İşlemleri

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `POST` | `/api/messages/typing/:jid` | Yazıyor göstergesi gönder |
| `POST` | `/api/messages/read/:jid` | Okundu olarak işaretle |

### Önbellek Yönetimi

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `DELETE` | `/api/messages/cache` | Tüm sohbet önbelleğini temizle |
| `DELETE` | `/api/messages/cache/:jid` | Belirli sohbet önbelleğini temizle |

### Zamanlanmış Mesajlar

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `POST` | `/api/messages/schedule` | Mesaj zamanla |
| `GET` | `/api/messages/scheduled` | Zamanlanmış mesajları listele |
| `GET` | `/api/messages/scheduled/:id` | Tekil detay |
| `PUT` | `/api/messages/scheduled/:id` | Düzenle |
| `DELETE` | `/api/messages/scheduled/:id` | İptal et |
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
| `/api/messages/stream` | Tüm mesajlar (message, sent, connected, disconnected) |
| `/api/messages/stream?jid=905xx` | Belirli numaranın mesajları |
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
# Text mesaj (otomatik typing göstergesi ile)
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{"jid": "905551234567", "message": "Merhaba!"}'

# Özel typing süresi (5 saniye)
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{"jid": "905551234567", "message": "Merhaba!", "typingDuration": 5000}'

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

# Zaman pencereli + ileri tarihli toplu gönderim
curl -X POST http://localhost:3000/api/bulk/send \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": ["905551111111", "905552222222"],
    "message": "Sadece mesai saatlerinde gönderilecek",
    "minDelay": 5000,
    "maxDelay": 15000,
    "timeWindow": { "startTime": "09:00", "endTime": "18:00" },
    "scheduledAt": "2026-02-26T09:00:00.000Z"
  }'
```

### Sohbet Filtreleme

```bash
# Tüm sohbetler
curl http://localhost:3000/api/messages/chats

# Okunmamış sohbetler
curl "http://localhost:3000/api/messages/chats?unread=true"

# Arama + sayfalama
curl "http://localhost:3000/api/messages/chats?search=Ahmet&page=1&limit=10"
```

### SSE ile Gerçek Zamanlı Dinleme

```javascript
const es = new EventSource('http://localhost:3000/api/messages/stream');

es.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'init':       console.log('Durum:', data.isConnected); break;
    case 'message':    console.log('Gelen:', data.data);        break;
    case 'sent':       console.log('Gönderilen:', data.data);   break;
    case 'connected':  console.log('WhatsApp bağlandı');        break;
    case 'disconnected': console.log('Bağlantı kesildi');       break;
  }
};
```

---

## 🧩 Chrome Addon — WhatsApp BOT Manager

Proje, tüm API özelliklerini görsel arayüzle kullanmanızı sağlayan bir **Chrome Extension** içerir.

### Addon Özellikleri

| Bölüm | Özellikler |
|-------|-----------|
| **Panel** | QR kod ile bağlanma · API ayarları · Sunucu ayarları (timezone, bildirim, otomatik okundu, arama reddi) · Sistem durumu · İstatistikler · Hızlı işlemler |
| **Sohbetler** | WhatsApp tarzı sohbet listesi · Arama ve filtreleme (tümü, okunmamış, arşiv) · Gerçek zamanlı mesajlaşma (SSE) · Yeni sohbet başlatma · Numara kontrolü |
| **Gönderim** | Tekli mesaj (hemen veya zamanlı) · Toplu mesaj (gecikme, zaman penceresi, ileri tarih) · Text / Resim / Video / Doküman desteği · Aktif iş ve zamanlı mesaj takibi |

### Akıllı Navigasyon

- **API bağlantısı yoksa** → Sadece Panel sekmesi erişilebilir, diğerleri kilitli
- **WhatsApp bağlı değilse** → Sohbetler ve Gönderim kilitli, Panel'de QR ekranı görünür
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
4. Bağlantı kuruldu → Sohbetler ve Gönderim aktif
5. Panel'den: Sunucu ayarları, istatistikler, hızlı işlemler
6. Sohbetler'den: Mesaj geçmişi, gerçek zamanlı mesajlaşma
7. Gönderim'den: Tekli/toplu mesaj, zamanlı gönderim
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
