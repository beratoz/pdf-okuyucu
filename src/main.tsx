import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./styles-library.css";

// Sağ tık menüsünü yalnızca metin seçiliyken / giriş alanlarında göster
document.addEventListener("contextmenu", (e) => {
  const target = e.target as Element;
  const hasSelection = !!window.getSelection()?.toString();
  if (!hasSelection && !target.closest("input, textarea")) e.preventDefault();
});

async function start() {
  // Geliştirmede uygulama normal tarayıcıda açılırsa Tauri komutlarını taklit et
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    await import("./dev-mock");
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
}

start();
