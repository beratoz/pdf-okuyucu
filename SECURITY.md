# Güvenlik / Security

## Açık bildirmek / Reporting a vulnerability

Bir güvenlik açığı bulduysanız lütfen herkese açık bir issue açmayın. GitHub'daki
**Security → Report a vulnerability** (özel bildirim) bölümünü kullanın.

*Please do not open a public issue for security problems. Use GitHub's private
**Security → Report a vulnerability** form instead.*

## API anahtarları nasıl korunuyor?

| Katman | Ne yapıyor |
|---|---|
| Saklama | Anahtarlar **Windows Kimlik Bilgisi Yöneticisi**'nde tutulur; proje dosyalarına, `%APPDATA%` altındaki ayar dosyalarına veya depoya yazılmaz. |
| Arayüzden gizleme | Anahtarlar arayüze (WebView) hiçbir zaman geri gönderilmez; arayüz yalnızca "kayıtlı / kayıtlı değil" bilgisini görür. İstekleri Rust tarafı yapar. |
| Adrese kilit | DeepL ve Gemini anahtarları yalnızca koda gömülü resmi adreslere gider. Eklenen sağlayıcıların anahtarı kaydedildiği adresin kökenine (ör. `https://api.deepseek.com`) kilitlenir; adres değişirse anahtar gönderilmez, yeniden girilmesi gerekir. |
| Şifreli bağlantı | Uzak sağlayıcı adresleri `https://` olmak zorundadır; `http://` yalnızca `localhost` (Ollama, LM Studio) için kabul edilir. Adrese kullanıcı adı/şifre gömülemez. |
| İçerik güvenlik politikası (CSP) | Arayüz dış sunuculara doğrudan bağlanamaz, dışarıdan betik yükleyemez, `eval` çalıştıramaz. |
| Dosya erişimi | Arayüz yalnızca `.pdf` ve `.md` dosyalarını okuyabilir. |
| Depo koruması | `.gitignore`, commit öncesi anahtar taraması (`scripts/check-secrets.mjs`), CI taraması ve GitHub'ın gizli anahtar taraması / push protection. |

## Bilinen sınırlar

- Windows Kimlik Bilgisi Yöneticisi, **aynı Windows kullanıcısıyla çalışan** programların erişimine açıktır. Güvenmediğiniz programları çalıştırmayın. Bir anahtarın sızdığından şüphelenirseniz servisin panelinden iptal edip yenisini oluşturun.
- Çeviri için seçtiğiniz metin ve çevresindeki paragraf, seçtiğiniz servise gönderilir. Google Gemini'nin ücretsiz katmanında gönderilen metin model geliştirmede kullanılabilir. Gizli belgeler için yerel bir model (Ollama / LM Studio) kullanabilirsiniz.
- Okuma geçmişi, çeviri geçmişi ve çizimler `%APPDATA%\com.okuyucu.pdf\` altında şifrelenmeden saklanır. Bu dosyalarda anahtar yoktur.
- Kurulum dosyası kod imzalı değildir; yalnızca bu deponun GitHub Releases sayfasından indirin.
