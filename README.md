# PDF Okuyucu

PDF ve Markdown dosyaları için hafif bir Windows masaüstü okuyucusu: kaldığınız yeri hatırlar,
seçtiğiniz metni çevirir, PDF üzerine çizim yapmanıza izin verir.

*A lightweight Windows desktop reader for PDF and Markdown files: remembers where you left off,
translates selected text, and lets you draw on PDFs. [English below ↓](#english)*

---

## Özellikler

- **Klasör kütüphanesi:** Klasörlerinizi açın; alt klasörlerdeki `.pdf` ve `.md` dosyaları listelenir. Alt klasörler kapalı başlar, arama yapılabilir.
- **Tümünü gör:** Bütün kitaplar klasörlere göre gruplanmış hâlde, PDF kapak görselleriyle görünür.
- **Kaldığı yeri hatırlama:** PDF'te sayfa, konum ve yakınlaştırma; Markdown'da kaydırma konumu saklanır.
- **Favoriler ve son okunanlar:** Okuma ilerlemesiyle birlikte. Kayıtlar seçilerek silinebilir; PDF dosyalarına dokunulmaz.
- **Seçerek çeviri:**
  - Metni seçin, **Çevir**'e basın (`Ctrl+T`).
  - Sıra varsayılan olarak **DeepL → Gemini Flash → Gemma** şeklindedir; biri kotasını doldurursa sıradakine geçilir.
  - Siz de sağlayıcı ekleyebilirsiniz: **Claude**, **DeepSeek**, **OpenRouter**, **Groq**, **Mistral**, **OpenAI**, **xAI**, **Together** ya da bilgisayarınızda çalışan **Ollama** / **LM Studio**. OpenAI uyumlu her servis "adres + anahtar + model" ile eklenebilir.
  - Seçimin çevresindeki paragraf bağlam olarak gönderilir. PDF'teki satır sonu tirelemeleri düzeltilir.
  - Çeviriler önbelleğe alınır ve belge başına geçmişte tutulur.
- **Kalemle çizim:** 10 renk, kalınlık ayarı, dokunduğu çizginin tamamını silen silgi, geri al (`Ctrl+D`, `Ctrl+Z`).
- **Temalar:** Açık, Sepya, Koyu, Gece. PDF sayfaları temaya ya da seçtiğiniz renklere boyanabilir.

## API anahtarlarınız nerede?

**Anahtarlar hiçbir zaman proje dosyalarında veya git deposunda tutulmaz.**

- Uygulamanın **Ayarlar** ekranına girdiğiniz anahtarlar **Windows Kimlik Bilgisi Yöneticisi**'nde saklanır (Denetim Masası → Kimlik Bilgisi Yöneticisi → Windows Kimlik Bilgileri → `com.okuyucu.pdf`).
- Anahtarlar arayüze geri gönderilmez; yalnızca çeviri isteği sırasında Rust tarafında, ilgili sağlayıcının adresine gönderilir.
- Her anahtar kaydedildiği adrese kilitlenir; başka bir adrese gönderilemez. Adresi değiştirirseniz anahtarı yeniden girmeniz istenir.
- Uzak sağlayıcı adresleri `https://` olmak zorundadır. `http://` yalnızca kendi bilgisayarınızdaki sunucular (`localhost`) için kabul edilir.
- Sıkı bir içerik güvenlik politikası (CSP), arayüzün dış sunuculara doğrudan bağlanmasını ve dışarıdan betik yüklemesini engeller. Ayrıntılar: [SECURITY.md](SECURITY.md).
- Okuma kayıtları (ayarlar, konumlar, çizimler) `%APPDATA%\com.okuyucu.pdf\` klasöründedir. Bu klasörde anahtar yoktur.

Depoya yanlışlıkla anahtar girmesine karşı üç kat koruma var:

1. `.gitignore`: `.env`, `*.key`, `secrets.*` gibi dosyalar hariç tutulur.
2. Commit öncesi kanca, `scripts/check-secrets.mjs` ile anahtar taraması yapar. Bir kez etkinleştirin:
   ```powershell
   git config core.hooksPath .githooks
   ```
3. GitHub Actions her gönderimde aynı taramayı çalıştırır.

Elle taramak için: `npm run check:secrets`

## Kurulum (kullanıcılar için)

1. [Releases](../../releases/latest) sayfasından **`PDF.Okuyucu_..._x64-setup.exe`** dosyasını indirin.
2. Çift tıklayıp kurun. Yönetici izni istemez; masaüstü ve Başlat menüsü kısayolu oluşturur.
3. Kurulum istemiyorsanız **`..._portable.exe`** dosyasını indirip doğrudan çalıştırabilirsiniz.

**“Windows bilgisayarınızı korudu” uyarısı:** Uygulama kod imzalı olmadığı için Windows SmartScreen bu uyarıyı gösterebilir. **Ek bilgi → Yine de çalıştır** deyin. Dosyalar bu depodaki kaynak koddan GitHub Actions üzerinde derlenir.

Kaldırmak için: **Ayarlar → Uygulamalar → PDF Okuyucu → Kaldır**. API anahtarlarınız Windows Kimlik Bilgisi Yöneticisi'nde kalır; isterseniz uygulamanın Ayarlar ekranından önce silebilirsiniz.

Ücretsiz çeviri anahtarları (kart gerekmez):

| Servis | Nereden | Ücretsiz |
|---|---|---|
| DeepL API Free | deepl.com/pro-api | Ayda 500.000 karakter |
| Google Gemini | aistudio.google.com/apikey | Gemini Flash ve Gemma için günlük kota |

## Geliştirme

Gerekenler: [Node.js](https://nodejs.org) 22+, [Rust](https://rustup.rs) ve Visual Studio C++ derleme araçları ([Tauri ön koşulları](https://tauri.app/start/prerequisites/)).

```powershell
npm install
git config core.hooksPath .githooks
npm run tauri dev
```

- `npm run tauri build`: kurulum dosyası üretir (NSIS).
- `cd src-tauri; cargo test`: Rust birim testleri.
- `npm run dev`: arayüzü normal tarayıcıda açar. Bu durumda `src/dev-mock.ts` Rust komutlarını taklit eder; üretim derlemesine girmez.

### Yeni bir çeviri servisi eklemek

- **OpenAI uyumlu bir servisse** kod yazmanıza gerek yok: uygulamada **Ayarlar → Ek sağlayıcılar → Sağlayıcı ekle → Diğer**. Hazır şablon listesine eklemek isterseniz `src/lib/providers.ts` içindeki `PRESETS` dizisine bir kayıt ekleyin.
- **Farklı bir istek biçimi kullanıyorsa** `src-tauri/src/providers.rs` dosyasına bir bağlayıcı fonksiyonu ekleyin, `translate.rs` içindeki `translate_text` yönlendirmesine yeni türü bağlayın, `src/lib/types.ts` içindeki `ProviderKind` türüne ekleyin.

### Yapı

```
src/                       React + TypeScript arayüz
  components/              Okuyucu, kütüphane, ayarlar, çeviri penceresi, sağlayıcı formu
  lib/
    providers.ts           Sağlayıcı listesi ve hazır şablonlar
    translate.ts           Yedek zinciri, önbellek, PDF metni temizleme
    ink.ts                 PDF üzerine çizim
    store.ts               Ayarlar, konumlar, geçmiş (tauri-plugin-store)
src-tauri/src/
  translate.rs             DeepL ve Gemini/Gemma
  providers.rs             OpenAI uyumlu servisler ve Claude
  secrets.rs               API anahtarları (Windows Kimlik Bilgisi Yöneticisi)
  files.rs, thumbs.rs      Klasör tarama, dosya okuma, kapak görselleri
scripts/check-secrets.mjs  Anahtar taraması
```

---

## English

A lightweight Windows desktop reader for PDF and Markdown files, built with [Tauri 2](https://tauri.app), React and [PDF.js](https://mozilla.github.io/pdf.js/).

**Features:**
- Folder library with PDF cover thumbnails.
- Remembers your reading position.
- Favorites and recent files.
- Select-to-translate: DeepL → Gemini Flash → Gemma by default, with automatic fallback.
- You can add Claude, DeepSeek, OpenRouter, Groq, Mistral, OpenAI, xAI, Together, Ollama, LM Studio, or any OpenAI-compatible endpoint.
- Pen drawing on PDFs.
- Light, sepia, dark and night themes.

**Your API keys stay private.**
- Keys entered in **Settings** are stored in the **Windows Credential Manager**, never in project files or the repository.
- They are only sent to the provider you configured. Remote endpoints must use HTTPS.
- A secret scanner (`npm run check:secrets`) runs as a pre-commit hook (`git config core.hooksPath .githooks`) and in CI.

**Development:**

```powershell
npm install
npm run tauri dev
```

You need Node.js 22+, Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/). Releases are built by GitHub Actions when a `v*` tag is pushed.

**Adding a provider:**
- OpenAI-compatible services need no code: use **Settings → Add provider → Other**, or add a preset to `src/lib/providers.ts`.
- Other APIs get an adapter in `src-tauri/src/providers.rs`.

## Lisans / License

[MIT](LICENSE)
