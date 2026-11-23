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
  lines.forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      if (re.test(line)) findings.push(`${file}:${i + 1}  →  ${name}`);
    }
  });
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
