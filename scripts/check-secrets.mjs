// Depoya girecek dosyalarda API anahtarı olup olmadığını tarar.
// Kullanım: npm run check:secrets   (git commit öncesi kanca ve GitHub Actions da çalıştırır)
// Bulursa hangi dosyada olduğunu yazar ve hata koduyla çıkar; anahtarın kendisini yazdırmaz.
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = [
  ["Google / Gemini API anahtarı", /AIza[0-9A-Za-z_-]{35}/],
  ["Anthropic (Claude) anahtarı", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI uyumlu anahtar (sk-...)", /\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{32,}/],
  ["DeepL anahtarı", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::fx)?\b(?=[^\n]{0,40}deepl|:fx)/i],
  ["Groq anahtarı", /\bgsk_[A-Za-z0-9]{40,}/],
  ["xAI anahtarı", /\bxai-[A-Za-z0-9]{40,}/],
  ["GitHub belirteci", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ["Özel anahtar dosyası", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "Koda yazılmış anahtar ataması",
    /(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-:.]{24,}["']/i,
  ],
];

const SKIP = [/^package-lock\.json$/, /\.(png|jpg|jpeg|gif|ico|icns|pdf|woff2?|ttf|lock)$/i, /^scripts\/check-secrets\.mjs$/];

const scanLine = (line, where, findings) => {
  for (const [name, re] of PATTERNS) if (re.test(line)) findings.push(`${where}  →  ${name}`);
};

// --history <git rev argümanları>: commit'lerin değişikliklerinde eklenen satırları tarar.
// Gönderim öncesi kanca (pre-push) yalnızca gönderilecek commit'leri, CI ise tüm geçmişi (--all) verir.
const hi = process.argv.indexOf("--history");
if (hi !== -1) {
  const revs = process.argv.slice(hi + 1);
  const findings = [];
  if (revs.length) {
    const log = execSync(`git log -p --no-color --no-ext-diff --format=@@commit%x20%h ${revs.join(" ")} --`, {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
    let commit = "?";
    let file = "?";
    for (const line of log.split("\n")) {
      if (line.startsWith("@@commit ")) commit = line.slice(9);
      else if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "");
      else if (line.startsWith("+") && !SKIP.some((re) => re.test(file))) scanLine(line, `${commit} ${file}`, findings);
    }
  }
  if (findings.length) {
    console.error("\n⛔ Gönderilecek commit'lerde olası API anahtarı var. Gönderim durduruldu:\n");
    for (const f of [...new Set(findings)]) console.error("  " + f);
    console.error(
      "\nAnahtarı dosyadan çıkarıp bu commit'leri düzeltin (git commit --amend veya git rebase). Üstüne yeni bir \"silme\" commit'i eklemek yetmez; anahtar geçmişte kalır.\n",
    );
    process.exit(1);
  }
  console.log("✓ Commit geçmişi anahtar taraması temiz.");
  process.exit(0);
}

// İzlenen + eklenmeyi bekleyen (yoksayılmayan) dosyalar
const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f) => !SKIP.some((re) => re.test(f)));

const findings = [];
for (const file of files) {
  let text;
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  lines.forEach((line, i) => scanLine(line, `${file}:${i + 1}`, findings));
}

if (findings.length) {
  console.error("\n⛔ Olası API anahtarı bulundu. Bu dosyaları commit etmeyin:\n");
  for (const f of findings) console.error("  " + f);
  console.error(
    "\nAnahtarlar koda değil, uygulamanın Ayarlar ekranına girilmeli (Windows Kimlik Bilgisi Yöneticisi'nde saklanır).\n",
  );
  process.exit(1);
}
console.log(`✓ Anahtar taraması temiz (${files.length} dosya).`);
