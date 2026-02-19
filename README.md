# WhatsApp BOT API

> **v2.0.0** - TypeScript ve Baileys kütüphanesi ile oluşturulmuş, MVC mimarisine sahip profesyonel WhatsApp BOT API.

## 🚀 Özellikler

### Temel Özellikler
- **QR ile Oturum Açma**: WhatsApp Web bağlantısı için QR kod desteği (SSE real-time)
- **Session Persistence**: PM2/sunucu yeniden başlatıldığında otomatik bağlanma (QR gerektirmez)
- **Mesaj Gönderme/Alma**: Text, resim, video, ses, doküman desteği
- **Otomatik Typing Göstergesi**: Mesaj gönderilmeden önce "yazıyor..." göstergesi (BOT algılamasını engeller)

### Gelişmiş Özellikler
- **Zamanlanmış Mesajlar**: Mesajları ileri tarihe zamanlama, düzenleme ve iptal
- **Mesaj Geçmişi**: WhatsApp'tan gerçek mesaj geçmişi çekme (session boyunca)
- **Sohbet Filtreleme**: Arşivlenmiş/okunmamış/ülke koduna göre filtreleme
- **Toplu Mesaj Gönderme**: In-memory kuyruk sistemi ile toplu mesaj

### Güvenlik & Performans
- **Kişi Kontrolü**: Numaranın WhatsApp'ta kayıtlı olup olmadığını kontrol
- **Sohbet İşlemleri**: Arşivleme, sabitleme, sessiz alma, yazıyor göstergesi
- **Grup Koruması**: Grup sohbetlerine erişim tamamen engelli
- **SSE Desteği**: Gerçek zamanlı QR ve mesaj güncellemeleri
- **Rate Limiting**: Spam koruması
- **Cache Management**: Bellek optimizasyonu ve temizleme
- **Request Tracing**: X-Request-ID ile istek takibi
- **TypeScript**: Tam tip güvenliği

> **⚠️ Önemli Not:** Mesaj geçmişi WhatsApp oturumu süresince bellekte tutulur. Uygulama yeniden başlatıldığında geçmiş sıfırlanır ancak yeni gelen/gönderilen mesajlar tekrar kaydedilir.

> **✅ Session Persistence:** PM2 veya sunucu yeniden başlatıldığında WhatsApp oturumu korunur ve otomatik olarak bağlanır. Sadece "Çıkış Yap" (logout) endpoint'i kullanıldığında oturum silinir ve tekrar QR kod okutmanız gerekir.

## 📁 Proje Yapısı

```
src/
├── app.ts                    # Ana uygulama başlatıcı
├── server.ts                 # Express sunucu kurulumu
├── config/
│   └── index.ts              # Ortam değişkenleri
├── controllers/
│   ├── AuthController.ts     # Kimlik doğrulama
│   ├── MessageController.ts  # Mesaj işlemleri
│   └── BulkController.ts     # Toplu mesaj
├── services/
│   ├── WhatsAppService.ts    # Baileys entegrasyonu
│   ├── MessageService.ts     # Mesaj servisi
│   └── QueueService.ts       # Kuyruk yönetimi
├── middlewares/
│   ├── errorHandler.ts       # Hata yakalama
│   ├── rateLimiter.ts        # Rate limiting
│   └── connectionGuard.ts    # Bağlantı kontrolü
├── routes/
│   └── index.ts              # API rotaları
├── types/
│   └── index.ts              # TypeScript tipleri
├── views/
│   └── ResponseFormatter.ts  # JSON formatları
└── utils/
    └── logger.ts             # Loglama
```

## 🛠️ Kurulum

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme modunda çalıştır
npm run dev

# veya watch modunda
npm run dev:watch

# Production build
npm run build
npm start
```

## ⚙️ Ortam Değişkenleri

`.env` dosyası oluşturun:

```env
PORT=3000
NODE_ENV=development
SESSION_PATH=./auth_info

# Timezone - tüm zamanlanmış mesajlar ve loglar bu saat dilimini kullanır
TZ=Europe/Istanbul

# WhatsApp Özellikleri
AUTO_READ=true
NOTIFY=false

# Otomatik Arama Reddi
AUTO_REJECT_CALLS=true

# Kuyruk Ayarları
QUEUE_DELAY_MS=3000
QUEUE_MAX_RETRY=3

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

## 📡 API Endpoints

### Kimlik Doğrulama

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/auth/qr` | QR kodu al (base64) |
| GET | `/api/auth/qr/image` | QR kodu PNG dosyası olarak al |
| GET | `/api/auth/qr/stream` | SSE ile QR akışı |
| GET | `/api/auth/status` | Bağlantı durumu |
| POST | `/api/auth/logout` | Oturumu kapat |

### Mesajlar

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| POST | `/api/messages/send` | Mesaj gönder (text, image, video, audio, document) |
| GET | `/api/messages/chats` | Tüm sohbetler (filtreleme destekli) |
| GET | `/api/messages/history/:jid` | Mesaj geçmişi (sayfalama destekli) |
| DELETE | `/api/messages/history/:jid?` | Geçmişi temizle |
| GET | `/api/messages/stats` | Sohbet istatistikleri |

### SSE Streams (Gerçek Zamanlı)

> **Güvenlik:** SSE endpoint'leri `CORS_WHITE_LIST` ayarındaki IP/domain'lerden erişime izin verir.

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/auth/qr/stream` | QR kodunu gerçek zamanlı dinle |
| GET | `/api/messages/stream` | Mesajları gerçek zamanlı dinle |
| GET | `/api/messages/stream?jid=905xx` | Belirli numaradan mesajları dinle |

### Zamanlanmış Mesajlar

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| POST | `/api/messages/schedule` | Mesaj zamanla |
| GET | `/api/messages/scheduled` | Zamanlanmış mesajları listele |
| GET | `/api/messages/scheduled/:id` | Zamanlanmış mesaj detayı |
| PUT | `/api/messages/scheduled/:id` | Zamanlanmış mesajı düzenle |
| DELETE | `/api/messages/scheduled/:id` | Zamanlanmış mesajı iptal et |
| DELETE | `/api/messages/scheduled/completed` | Tamamlanmış zamanlanmış mesajları temizle |

### Kişi & Profil

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/messages/check/:phone` | Numara WhatsApp'ta kayıtlı mı kontrol et |
| GET | `/api/messages/profile/:jid` | Profil bilgisi al |

### Sohbet İşlemleri

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| POST | `/api/messages/typing/:jid` | Yazıyor göstergesi gönder |
| POST | `/api/messages/read/:jid` | Sohbeti okundu olarak işaretle |
| POST | `/api/messages/archive/:jid` | Sohbeti arşivle/arşivden çıkar |
| POST | `/api/messages/pin/:jid` | Sohbeti sabitle/sabitlemeyi kaldır |
| POST | `/api/messages/mute/:jid` | Sohbeti sessize al/sessizden çıkar |
| DELETE | `/api/messages/:jid/:messageId` | Mesaj sil |

### Toplu Mesaj (Gelişmiş)

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| POST | `/api/bulk/send` | Toplu mesaj kuyruğu oluştur |
| GET | `/api/bulk/jobs` | Tüm işler |
| GET | `/api/bulk/status/:jobId` | İş durumu |
| GET | `/api/bulk/status/:jobId/detailed` | Detaylı durum (alıcı bazlı) |
| POST | `/api/bulk/pause/:jobId` | İşi duraklat |
| POST | `/api/bulk/resume/:jobId` | İşi devam ettir |
| POST | `/api/bulk/cancel/:jobId` | İşi iptal et |
| DELETE | `/api/bulk/job/:jobId` | İşi sil |
| DELETE | `/api/bulk/completed` | Tamamlananları temizle |

**Gelişmiş Bulk Mesaj Özellikleri:**
- 📅 **Zamanlama**: `scheduledAt` ile belirli bir zamanda başlatma
- ⏰ **Zaman Penceresi**: `timeWindow` ile sadece belirli saatlerde gönderim (örn: 09:00-18:00)
- 📎 **Medya Desteği**: Resim, video, ses, döküman gönderimi
- ⌨️ **Typing Göstergesi**: Her mesaj öncesi yazıyor göstergesi
- ⏱️ **Gecikme Ayarları**: `minDelay`/`maxDelay` ile rastgele gecikme
- ⏸️ **Duraklat/Devam**: İşleri manuel olarak durdurma ve devam ettirme
- 📊 **Detaylı İstatistik**: Tahmini bitiş zamanı, ortalama mesaj süresi

### Ayarlar

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/settings` | Tüm ayarları getir |
| PUT | `/api/settings` | Ayarları güncelle (anında geçerli) |

### Sunucu İstatistikleri

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/stats` | Tüm istatistikler |
| GET | `/api/stats/system` | Sistem istatistikleri |
| GET | `/api/stats/whatsapp` | WhatsApp bağlantı durumu |
| GET | `/api/stats/queue` | Kuyruk istatistikleri |

### Cache Yönetimi

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/cache/stats` | Cache istatistikleri |
| POST | `/api/cache/clear` | Cache'i temizle ve RAM'i serbest bırak |

## 📝 Kullanım Örnekleri

### SSE ile Gerçek Zamanlı Mesaj Dinleme

```javascript
// JavaScript EventSource ile mesaj dinleme
const eventSource = new EventSource('http://localhost:3000/api/messages/stream', {
  headers: { 'X-API-Key': 'your_api_key' }
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case 'init':
      console.log('Bağlantı durumu:', data.isConnected);
      break;
    case 'message':
      console.log('Yeni mesaj:', data.data);
      break;
    case 'sent':
      console.log('Mesaj gönderildi:', data.data);
      break;
    case 'connected':
      console.log('WhatsApp bağlandı');
      break;
    case 'disconnected':
      console.log('WhatsApp bağlantısı kesildi:', data.reason);
      break;
    case 'heartbeat':
      console.log('Bağlantı aktif');
      break;
  }
};

// Belirli bir numaradan gelen mesajları dinle
const filteredSource = new EventSource(
  'http://localhost:3000/api/messages/stream?jid=905551234567'
);
```

```bash
# curl ile SSE dinleme
curl -N http://localhost:3000/api/messages/stream \
  -H "X-API-Key: your_api_key"
```

### QR Kod Alma (Base64)

```bash
curl http://localhost:3000/api/auth/qr
```

### QR Kod Alma (PNG Görsel)

```bash
# Tarayıcıda doğrudan aç veya dosyaya kaydet
curl http://localhost:3000/api/auth/qr/image --output qr.png
```

### QR Görselini HTML'de Kullanma

```html
<!-- PNG dosyası olarak -->
<img src="http://localhost:3000/api/auth/qr/image" alt="QR Code" />
```

### Mesaj Gönderme

Tüm mesajlar gönderilmeden önce otomatik olarak "yazıyor..." göstergesi gönderilir (varsayılan 3 saniye).

```bash
# Text mesaj (otomatik 3sn typing göstergesi ile)
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{"jid": "905551234567", "message": "Merhaba!"}'

# Text mesaj (özel typing süresi ile - 5 saniye)
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "jid": "905551234567",
    "message": "Merhaba!",
    "typingDuration": 5000
  }'

# Zamanlanmış mesaj (send endpoint'i üzerinden)
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "jid": "905551234567",
    "message": "Bu mesaj yarın saat 10'da gönderilecek",
    "scheduledAt": "2026-02-17T10:00:00.000Z"
  }'

# Resim gönder (URL ile)
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "jid": "905551234567",
    "type": "image",
    "mediaUrl": "https://example.com/image.jpg",
    "caption": "Bu bir resim"
  }'

# Ses gönder (base64 ile)
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "jid": "905551234567",
    "type": "audio",
    "mediaBase64": "BASE64_ENCODED_AUDIO_DATA"
  }'

# Doküman gönder
curl -X POST http://localhost:3000/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "jid": "905551234567",
    "type": "document",
    "mediaUrl": "https://example.com/file.pdf",
    "fileName": "rapor.pdf",
    "caption": "Rapor dosyası"
  }'
```

### Sohbetleri Filtreleme

```bash
# Tüm sohbetler
curl http://localhost:3000/api/messages/chats

# Okunmamış sohbetler
curl "http://localhost:3000/api/messages/chats?unread=true"

# Arşivlenmiş sohbetler
curl "http://localhost:3000/api/messages/chats?archived=true"

# Türkiye numaraları (+90)
curl "http://localhost:3000/api/messages/chats?countryCode=90"

# Arama ve sayfalama
curl "http://localhost:3000/api/messages/chats?search=Ahmet&page=1&limit=10"

# Sıralama (son mesaja göre)
curl "http://localhost:3000/api/messages/chats?sortBy=lastMessage&sortOrder=desc"
```

### Zamanlanmış Mesaj

```bash
# Mesaj zamanla
curl -X POST http://localhost:3000/api/messages/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "jid": "905551234567",
    "message": "Bu mesaj 2 saat sonra gönderilecek",
    "scheduledAt": "2026-02-16T14:00:00.000Z"
  }'

# Zamanlanmış mesajları listele
curl http://localhost:3000/api/messages/scheduled

# Zamanlanmış mesajı güncelle
curl -X PUT http://localhost:3000/api/messages/scheduled/MESSAGE_ID \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Güncellenmiş mesaj",
    "scheduledAt": "2026-02-16T16:00:00.000Z"
  }'

# Zamanlanmış mesajı iptal et
curl -X DELETE http://localhost:3000/api/messages/scheduled/MESSAGE_ID
```

### Kişi & Profil

```bash
# Numara WhatsApp'ta kayıtlı mı?
curl http://localhost:3000/api/messages/check/905551234567

# Profil bilgisi al
curl http://localhost:3000/api/messages/profile/905551234567
```

### Sohbet İşlemleri

```bash
# Yazıyor göstergesi gönder (3 saniye)
curl -X POST http://localhost:3000/api/messages/typing/905551234567 \
  -H "Content-Type: application/json" \
  -d '{"duration": 3000}'

# Sohbeti okundu olarak işaretle
curl -X POST http://localhost:3000/api/messages/read/905551234567

# Sohbeti arşivle
curl -X POST http://localhost:3000/api/messages/archive/905551234567 \
  -H "Content-Type: application/json" \
  -d '{"archive": true}'

# Sohbeti sabitle
curl -X POST http://localhost:3000/api/messages/pin/905551234567 \
  -H "Content-Type: application/json" \
  -d '{"pin": true}'

# Mesaj sil
curl -X DELETE http://localhost:3000/api/messages/905551234567/MESSAGE_ID
```

### Toplu Mesaj

```bash
curl -X POST http://localhost:3000/api/bulk/send \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": ["905551111111", "905552222222", "905553333333"],
    "message": "Toplu mesaj!"
  }'
```

### SSE ile QR Dinleme (JavaScript)

```javascript
const eventSource = new EventSource('http://localhost:3000/api/auth/qr/stream');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'qr') {
    // QR kodunu göster (base64 image)
    document.getElementById('qr').src = data.qrCode;
  } else if (data.type === 'connected') {
    // Bağlandı
    console.log('Connected:', data.session);
    eventSource.close();
  }
};
```

### Sunucu İstatistikleri

```bash
# Tüm istatistikleri al
curl http://localhost:3000/api/stats

# Sadece kuyruk durumunu al
curl http://localhost:3000/api/stats/queue
```

## ⏱️ QR Kod Timeout Mekanizması

QR kod oluşturma işlemi sunucu yükünü önlemek için otomatik timeout mekanizmasına sahiptir:

- **Maksimum QR Denemesi**: 5 kez QR yenilemesi
- **Bağlantı Timeout**: 2 dakika
- **QR Süresi**: Her QR 60 saniye geçerli

QR taranmazsa bağlantı otomatik olarak durdurulur ve sunucu kaynakları serbest bırakılır.

## 🔧 Teknolojiler

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **WhatsApp**: Baileys (@whiskeysockets/baileys)
- **Logging**: Pino

## 📋 API Response Formatı

Tüm API yanıtları aşağıdaki formatta döner:

```json
{
  "success": true,
  "data": { ... },
  "message": "İşlem başarılı",
  "timestamp": "2026-02-15T12:00:00.000Z"
}
```

Hata durumunda:

```json
{
  "success": false,
  "error": "Hata detayı",
  "message": "Hata mesajı",
  "timestamp": "2026-02-15T12:00:00.000Z"
}
```

## 📮 Postman Collection

Proje içinde hazır Postman collection dosyaları bulunmaktadır:

```
postman/
├── WhatsApp-BOT-API.postman_collection.json     # API Collection
├── WhatsApp-BOT-Local.postman_environment.json  # Local Environment
└── WhatsApp-BOT-Production.postman_environment.json  # Production Environment
```

### Postman'a Aktarma:

1. Postman'ı açın
2. **Import** butonuna tıklayın
3. `postman/` klasöründeki dosyaları sürükleyip bırakın
4. Environment olarak "WhatsApp BOT - Local" seçin
5. API'yi test etmeye başlayın!

### Collection İçeriği:

| Klasör | Endpoint Sayısı | Açıklama |
|--------|-----------------|----------|
| Health Check | 1 | Sunucu sağlık kontrolü (Auth gerektirmez) |
| SSE Streams | 3 | QR ve mesaj real-time dinleme |
| Authentication | 5 | QR, QR Image, Status, Logout, Cancel |
| Messages | 15 | Mesaj gönderme, sohbet işlemleri |
| Scheduled Messages | 6 | Zamanlanmış mesaj yönetimi |
| Bulk Messages | 11 | Gelişmiş toplu mesaj yönetimi |
| Settings | 2 | Tüm ayarları görüntüle ve güncelle |
| Server Stats | 4 | Sistem ve kuyruk istatistikleri |
| Cache Management | 2 | Bellek yönetimi ve temizleme |

## 🔧 Chrome Extension

Proje içinde Chrome uzantısı bulunmaktadır. Detaylı kurulum ve kullanım için `chrome-extension/README.md` dosyasına bakın.

### Özellikler:
- 🔗 QR kod ile bağlantı yönetimi
- 💬 Mesaj gönderimi (text, image, video, audio, document)
- 📋 Sohbet listesi ve filtreleme
- 📨 Toplu mesaj gönderimi
- ⏰ Zamanlanmış mesajlar
- 📊 İstatistik görüntüleme

## 📜 Lisans

MIT
