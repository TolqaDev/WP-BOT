# WhatsApp BOT Manager — Chrome Addon

> **v2.0.0** — WhatsApp BOT API için geliştirilmiş Chrome Extension. Tüm API özelliklerini görsel arayüzle yönetin.

## ✨ Özellikler

### Panel (Dashboard)
- 🔗 QR kod ile WhatsApp bağlantısı (SSE real-time)
- ⚙️ Inline API bağlantı ayarları (URL, Key, Test)
- 🛠 Sunucu ayarları (saat dilimi, otomatik okundu, bildirimler, arama reddi)
- 📊 Sistem durumu (uptime, bellek, sağlık)
- 📈 WhatsApp istatistikleri (bağlantı süresi, gönderilen, kuyruk)
- ⚡ Hızlı işlem butonları

### Sohbetler
- 💬 WhatsApp tarzı sohbet listesi
- 🔍 Arama ve filtreleme (tümü, okunmamış, arşiv)
- 📨 Gerçek zamanlı mesajlaşma (SSE)
- 👤 Yeni sohbet başlatma ve numara kontrolü
- 📜 Mesaj geçmişi görüntüleme

### Gönderim
- 📤 Tekli mesaj (hemen veya zamanlı)
- 📦 Toplu mesaj (gecikme, zaman penceresi, ileri tarih zamanlaması)
- 📎 Medya desteği (text, resim, video, doküman)
- ⏰ Zamanlı mesaj listesi ve takibi
- 📋 Aktif toplu iş takibi (duraklat, devam, iptal)

### Akıllı Navigasyon
- 🔒 API bağlantısı yoksa → Sadece Panel erişilebilir
- 🔒 WhatsApp bağlı değilse → Sohbetler ve Gönderim kilitli
- ✅ Bağlı olduğunda → Tüm sekmeler aktif

---

## 🛠 Kurulum

### 1. Chrome'a Yükleme

1. Chrome'da `chrome://extensions` adresine gidin
2. Sağ üstten **Geliştirici modu**'nu açın
3. **Paketlenmemiş öğe yükle** butonuna tıklayın
4. `chrome-extension` klasörünü seçin
5. Yüklenen Extension'ın **ID**'sini not edin

### 2. API CORS Ayarı

Extension'ın API'ye erişebilmesi için CORS whitelist'ine eklenmesi gerekir:

**API üzerinden:**
```bash
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"corsWhiteList": ["chrome-extension://YOUR_EXTENSION_ID"]}'
```

**.env dosyasına ekleyerek:**
```env
CORS_WHITELIST=chrome-extension://YOUR_EXTENSION_ID,http://localhost:3000
```

### 3. Addon'da API Bağlantısı

1. Extension ikonuna tıklayın → **Panel** sekmesi açılır
2. QR alanının altındaki **API Ayarları** bölümünü açın
3. API URL girin (varsayılan: `http://localhost:3000/api`)
4. Varsa API Key girin
5. **Test** ile bağlantıyı doğrulayın → **Kaydet**

---

## 📖 Kullanım

### Panel
- QR kodu tarayarak WhatsApp'a bağlanın
- Bağlandıktan sonra oturum bilgileri, istatistikler ve sunucu ayarları görünür
- Sunucu ayarlarını (timezone, bildirim, otomatik okundu, arama reddi) buradan düzenleyin
- Hızlı işlem butonları ile diğer sekmelere geçiş yapın

### Sohbetler
- Sol panelden sohbet seçin veya arama yapın
- Okunmamış / Arşiv filtreleri ile listeleyin
- Sohbete tıklayarak mesaj geçmişini görün ve yanıt verin
- "+" butonu ile yeni sohbet başlatın

### Gönderim — Tekli Mesaj
1. Alıcı numarasını girin (ör: `905551234567`)
2. "Hemen Gönder" veya "Zamanla" seçin
3. Mesaj tipini belirleyin (text / resim / video / doküman)
4. Mesajı yazın ve gönderin

### Gönderim — Toplu Mesaj
1. Her satıra bir numara olacak şekilde alıcıları girin
2. Min/Max gecikme sürelerini ayarlayın
3. İsteğe bağlı: Zaman penceresi veya ileri tarih zamanlaması ekleyin
4. "Toplu Gönderimi Başlat" ile başlatın
5. Sağ panelden aktif işleri takip edin

---

## 🎨 Tasarım

- **Dark tema** — WhatsApp markasına uygun
- **Pencere boyutu**: 720×580 px
- **Ana renk**: `#00A884` (WhatsApp yeşili)
- **Arka plan**: `#1A1E23`
- **Manifest V3** — Modern Chrome Extension API

---

## 🔒 Güvenlik

- API Key'ler Chrome'un güvenli `chrome.storage` API'sinde saklanır
- Tüm istekler CORS ayarlarına uygun şekilde yapılır
- Hassas bilgiler loglanmaz

---

## 📋 Gereksinimler

- Chrome 88+ veya uyumlu Chromium tabanlı tarayıcı
- WhatsApp BOT API'nin çalışır durumda olması
- API'ye erişim izni (localhost veya CORS whitelist)

---

## 🔧 Sorun Giderme

| Sorun | Çözüm |
|-------|-------|
| API bağlantısı kurulamadı | API sunucusunun çalıştığını ve URL'nin doğru olduğunu kontrol edin |
| CORS hatası | Extension ID'nin CORS whitelist'ine eklendiğinden emin olun |
| QR kod görünmüyor | "Bağlantıyı Başlat" butonuna tıklayın, API'nin logout durumunda olduğunu doğrulayın |
| Sekmeler kilitli | WhatsApp bağlantısının aktif olduğunu kontrol edin (Panel → QR tara) |
| Mesaj gönderilemiyor | Numara formatını kontrol edin (ülke kodu ile, ör: `905551234567`) |

---

## 📜 Lisans

MIT
