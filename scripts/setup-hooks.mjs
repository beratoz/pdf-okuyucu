// npm install sırasında (prepare) anahtar taraması kancalarını otomatik etkinleştirir.
// Git deposu dışında (ör. zip olarak indirildiyse) sessizce hiçbir şey yapmaz.
import { execSync } from "node:child_process";

try {
  execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
  console.log("✓ Anahtar taraması kancaları etkin (commit ve push öncesi).");
} catch {
  // git yok veya depo değil
}
