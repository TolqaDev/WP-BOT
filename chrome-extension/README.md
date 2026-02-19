# WhatsApp BOT Manager - Chrome Extension

> **v2.0.0** - WhatsApp BOT API için optimize edilmiş Chrome uzantısı.

Tüm API özelliklerini kullanıcı dostu bir arayüzle yönetmenizi sağlar.

## ✨ Özellikler

### Bağlantı Yönetimi
- 🔗 QR kod ile WhatsApp bağlantısı (real-time SSE)
- 🔄 Otomatik yeniden bağlanma
- 📊 Bağlantı durumu izleme

### Mesajlaşma
- 💬 Metin, resim, video, ses ve belge gönderimi
- ⌨️ Otomatik yazıyor göstergesi
- 📋 Sohbet listesi ve filtreleme
- 🔍 Numara kontrolü (WhatsApp kayıt durumu)

### Toplu İşlemler
- 📨 Çoklu alıcılara gecikme ayarlı mesaj gönderimi
- ⏰ İleri tarihe mesaj planlama
- ⏸️ İş duraklatma/devam ettirme
- 📈 Detaylı ilerleme takibi

### Performans
- ⚡ Optimize edilmiş API istekleri
- 🗃️ İstek önbellekleme
- 📊 Sistem ve mesaj istatistikleri

## Kurulum

### 1. Extension'ı Chrome'a Yükleme

1. Chrome tarayıcısını açın
2. `chrome://extensions` adresine gidin
3. Sağ üstteki "Geliştirici modu"nu açın
4. "Paketlenmemiş öğe yükle" butonuna tıklayın
5. `chrome-extension` klasörünü seçin
6. Extension yüklendikten sonra **Extension ID**'yi not edin (örn: `abcdefghijklmnopqrstuvwxyz123456`)

### 2. API CORS Ayarları

Extension'ın API'ye erişebilmesi için CORS whitelist'ine eklenmesi gerekir:

**Yöntem 1: API Settings Endpoint ile**
```bash
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"corsWhiteList": ["chrome-extension://YOUR_EXTENSION_ID"]}'
```

**Yöntem 2: .env dosyasına ekleyerek**
```
CORS_WHITELIST=chrome-extension://YOUR_EXTENSION_ID,http://localhost:3000
```

### 3. Extension Ayarları

1. Extension ikonuna tıklayın
2. Sağ üstteki ⚙️ ayarlar ikonuna tıklayın
3. API URL'nizi girin (varsayılan: `http://localhost:3000/api`)
4. Eğer varsa API Key'inizi girin
5. "Kaydet" butonuna tıklayın

## Kullanım

### Panel (Dashboard)
- Bağlantı durumunu görün
- QR kod ile bağlanın
- Hızlı istatistikleri takip edin
- Hızlı işlem butonlarını kullanın

### Mesaj
- Telefon numarası girin
- "Kontrol" butonuyla WhatsApp kaydını sorgulayın
- Mesaj tipini seçin (metin/resim/video/ses/belge)
- Mesajınızı yazın ve gönderin

### Sohbetler
- Tüm sohbetleri listeleyin
- Arama yapın
- Okunmamış/arşivli filtreleri kullanın
- Sohbete tıklayarak mesaj geçmişini görün ve yanıt verin

### Toplu Gönderim
- Alıcı numaralarını her satıra bir tane olacak şekilde girin
- Mesaj tipini ve içeriğini belirleyin
- Min/Max gecikme sürelerini ayarlayın
- İsteğe bağlı zaman penceresi tanımlayın
- "Gönderimi Başlat" butonuyla başlatın
- Aktif işleri takip edin, duraklatın veya iptal edin

### Zamanlı Mesajlar
- Alıcı ve mesaj bilgilerini girin
- Gönderim tarih/saatini seçin
- "Zamanla" butonuyla planlayın
- Zamanlı mesajları listeden takip edin

## Tasarım

Extension, WhatsApp BOT markasına uygun dark tema kullanır:
- Ana arka plan: `#1A1E23`
- Vurgu rengi: `#00983A` (WhatsApp yeşili)
- Metin: `#FFFFFF`

## Güvenlik

- API Key'ler Chrome'un güvenli storage'ında saklanır
- Tüm API istekleri CORS ayarlarına uygun şekilde yapılır
- Hassas bilgiler asla loglanmaz

## Gereksinimler

- Chrome 88+ veya uyumlu Chromium tabanlı tarayıcı
- WhatsApp BOT API'nin çalışır durumda olması
- API'ye erişim izni (localhost veya CORS whitelist)

## Sorun Giderme

### "API bağlantısı kurulamadı" hatası
1. API sunucusunun çalıştığından emin olun
2. API URL'nin doğru olduğunu kontrol edin
3. CORS ayarlarında extension origin'inin ekli olduğunu kontrol edin

### QR kod görünmüyor
1. API'nin bağlı olmadığından emin olun
2. "Bağlan" butonuna tekrar tıklayın
3. Sayfayı yenileyin

### Mesaj gönderilemiyor
1. WhatsApp bağlantısının aktif olduğunu kontrol edin
2. Telefon numarasının doğru formatta olduğunu kontrol edin
3. API loglarını inceleyin

## Lisans

MIT License

## Destek

Sorularınız için GitHub Issues kullanabilirsiniz.
