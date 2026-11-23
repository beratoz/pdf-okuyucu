// Ekran görünüm tercihleri (açık/kapalı klasörler, kaydırma konumu).
// Önemli veri değildir; okunamazsa varsayılan görünüm kullanılır.
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const PREFIX = "gorunum:";

export function loadView<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveView(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* depolama kullanılamıyorsa sessizce geç */
  }
}

/**
 * Kaydırılabilir bir alanın konumunu hatırlar ve geri yükler.
 * `ready` true olduğunda (içerik çizildiğinde) bir kez geri yükler;
 * `key` değişirse (ör. sekme değişimi) o anahtarın konumuna geçer.
 */
export function useRememberScroll(ref: RefObject<HTMLElement | null>, key: string, ready: boolean) {
  const restoredFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ready || restoredFor.current === key) return;
    restoredFor.current = key;
    const top = loadView<number>(`scroll:${key}`, 0);
    el.scrollTop = top;
    // Görseller / gruplar çizildikçe yükseklik artabilir: bir kare sonra tekrar dene
    requestAnimationFrame(() => {
      if (el.scrollTop < top) el.scrollTop = top;
    });
  }, [ref, key, ready]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Kaydırırken kare başına en fazla bir kez kaydet (hafif ve kayıpsız)
    let frame = 0;
    const onScroll = () => {
      if (restoredFor.current !== key || frame) return; // geri yükleme bitmeden kaydetme
      frame = requestAnimationFrame(() => {
        frame = 0;
        saveView(`scroll:${key}`, Math.round(el.scrollTop));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ref, key]);
}
