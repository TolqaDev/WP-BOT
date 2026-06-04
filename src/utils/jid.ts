/**
 * WhatsApp JID (adres) yardımcıları.
 *
 * Tüm servisler aynı numara biçimlendirmesini kullansın diye burada tek yerde
 * toplandı. Daha önce aynı kod 4 ayrı dosyada kopyalanmıştı.
 */

/** Grup veya broadcast adresi mi? (Bu serviste gruplara mesaj atılmaz.) */
export function isGroupJid(jid: string): boolean {
  return jid.includes('@g.us') || jid.includes('@broadcast');
}

/**
 * Bir telefon numarasını/JID'i standart `905551234567@s.whatsapp.net` biçimine çevirir.
 * - Zaten `@s.whatsapp.net` ise cihaz son ekini (`:12`) temizler.
 * - Grup adresine dokunmaz.
 * - Başındaki `0`'ı atar; 10 hane + 90 yoksa başına `90` ekler (Türkiye varsayılanı).
 */
export function formatJid(jid: string): string {
  if (jid.includes('@s.whatsapp.net')) {
    const phone = jid.split('@')[0].split(':')[0];
    return `${phone}@s.whatsapp.net`;
  }

  if (jid.includes('@g.us')) {
    return jid;
  }

  let cleaned = jid.replace(/[^\d]/g, '').replace(/^0+/, '');

  if (cleaned.length === 10 && !cleaned.startsWith('90')) {
    cleaned = '90' + cleaned;
  }

  return `${cleaned}@s.whatsapp.net`;
}
