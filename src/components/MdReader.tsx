import { convertFileSrc } from "@tauri-apps/api/core";
import MarkdownIt from "markdown-it";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { api } from "../lib/api";
import { dirOf, isAbsolutePath, joinPath } from "../lib/paths";
import type { FileEntry, Position } from "../lib/types";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });

export interface MdReaderApi {
  scrollToTop(): void;
}

interface Props {
  file: FileEntry;
  fontSize: number;
  colors: { bg: string; fg: string };
  getPosition: () => Position | undefined;
  onPosition: (p: Position) => void;
  onProgress: (ratio: number) => void;
  onError: (message: string) => void;
  apiRef: Ref<MdReaderApi>;
}

function slugify(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export default function MdReader(props: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const cb = useRef(props);
  cb.current = props;

  useImperativeHandle(props.apiRef, () => ({
    scrollToTop: () => scrollRef.current?.scrollTo({ top: 0 }),
  }));

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    api
      .readTextFile(props.file.path)
      .then((text) => !cancelled && setSource(text))
      .catch((e) => !cancelled && cb.current.onError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [props.file.path]);

  const html = useMemo(() => (source === null ? "" : md.render(source)), [source]);

  // İçerik çizildikten sonra: görsel yollarını düzelt, başlıklara id ver, konumu geri yükle
  useEffect(() => {
    const article = articleRef.current;
    const scroller = scrollRef.current;
    if (!article || !scroller || source === null) return;
    const base = dirOf(props.file.path);
    article.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src || /^(https?:|data:|asset:|http:\/\/asset\.)/i.test(src)) return;
      const abs = isAbsolutePath(src) ? src : joinPath(base, decodeURIComponent(src));
      img.src = convertFileSrc(abs);
      img.loading = "lazy";
    });
    article.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      if (!h.id) h.id = slugify(h.textContent ?? "");
    });
    const pos = cb.current.getPosition();
    requestAnimationFrame(() => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (pos?.ratio && max > 0) scroller.scrollTop = pos.ratio * max;
      cb.current.onProgress(max > 0 ? scroller.scrollTop / max : 1);
    });
  }, [html, source, props.file.path]);

  useEffect(() => {
    const scroller = scrollRef.current!;
    let timer: number | undefined;
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      const ratio = max > 0 ? scroller.scrollTop / max : 1;
      cb.current.onProgress(ratio);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        cb.current.onPosition({ ratio, updated: Date.now() });
      }, 400);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={scrollRef} className="md-scroll">
      <article
        ref={articleRef}
        className="md-article"
        style={{
          fontSize: props.fontSize,
          background: props.colors.bg,
          color: props.colors.fg,
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {source === null && <div className="center-note">Yükleniyor…</div>}
    </div>
  );
}
