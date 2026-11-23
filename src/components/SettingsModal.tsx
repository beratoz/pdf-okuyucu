import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { api, toErrorInfo } from "../lib/api";
import { LANGUAGES } from "../lib/languages";
import { cacheClear, cacheCount } from "../lib/store";
import { PAGE_PRESETS, THEMES } from "../lib/themes";
import { resetCooldowns } from "../lib/translate";
import { allProviders, getProvider, KIND_LABEL } from "../lib/providers";
import type { ClearOptions, EngineMode, PageMode, Provider, Settings } from "../lib/types";
import ProviderForm from "./ProviderForm";
import { IconArrowDown, IconArrowUp, IconClose, IconExternal } from "./Icons";

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onClearAll: (opts: ClearOptions) => void;
  toast: (msg: string, kind?: "info" | "error") => void;
}

type ModelInfo = { id: string; displayName: string };

function pickGemini(models: ModelInfo[]): string | undefined {
  const ids = models.map((m) => m.id);
  if (ids.includes("gemini-flash-latest")) return "gemini-flash-latest";
  const bad = /(lite|image|tts|live|audio|embed|thinking|exp|robotics|computer)/i;
  const cands = ids.filter((id) => /^gemini-[\d.]+-flash/.test(id) && !bad.test(id));
  const stable = cands.filter((id) => !/preview/i.test(id));
  const pool = stable.length ? stable : cands;
  return pool.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
}

function pickGemma(models: ModelInfo[]): string | undefined {
  const ids = models.map((m) => m.id).filter((id) => id.startsWith("gemma"));
  if (ids.includes("gemma-4-31b-it")) return "gemma-4-31b-it";
  const size = (id: string) => Number(id.match(/(\d+)b/)?.[1] ?? 0);
  return ids.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }) || size(b) - size(a))[0];
}

function KeyField({
  provider,
  label,
  help,
  helpUrl,
  onSaved,
  toast,
}: {
  provider: "deepl" | "gemini";
  label: string;
  help: string;
  helpUrl: string;
  onSaved: () => void;
  toast: Props["toast"];
}) {
  const [has, setHas] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.hasApiKey(provider).then(setHas);
  }, [provider]);

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await api.setApiKey(provider, value.trim());
      setValue("");
      setHas(true);
      resetCooldowns();
      onSaved();
      toast(`${label} kaydedildi`);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`${label} silinsin mi?`)) return;
    await api.deleteApiKey(provider);
    setHas(false);
    onSaved();
  };

  return (
    <div className="key-field">
      <div className="key-head">
        <strong>{label}</strong>
        {has === true && <span className="badge ok">Kayıtlı ✓</span>}
        {has === false && <span className="badge warn">Girilmedi</span>}
        <div className="grow" />
        <button className="link-btn" onClick={() => openUrl(helpUrl)}>
          Ücretsiz anahtar al <IconExternal size={12} />
        </button>
      </div>
      <div className="row">
        <input
          type="password"
          placeholder={has ? "Yeni anahtarla değiştir…" : "Anahtarı buraya yapıştırın"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn primary" onClick={save} disabled={busy || !value.trim()}>
          Kaydet
        </button>
        {has && (
          <button className="btn" onClick={remove}>
            Sil
          </button>
        )}
      </div>
      <div className="hint">{help}</div>
    </div>
  );
}

export default function SettingsModal({ settings: s, update, onClose, onClearAll, toast }: Props) {
  const [clearOpts, setClearOpts] = useState<ClearOptions>({ recent: true, progress: true, translations: false });
  const [usage, setUsage] = useState<{ characterCount: number; characterLimit: number } | null>(null);
  const [usageErr, setUsageErr] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelErr, setModelErr] = useState<string | null>(null);
  const [cacheN, setCacheN] = useState<number | null>(null);
  /** "new" = yeni sağlayıcı formu açık, kimlik = o sağlayıcı düzenleniyor */
  const [formFor, setFormFor] = useState<string | null>(null);
  const [customKeys, setCustomKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.all(
      s.customProviders.map(async (p) => [p.id, p.local ? true : await api.hasApiKey(p.keyRef)] as const),
    ).then((entries) => setCustomKeys(Object.fromEntries(entries)));
  }, [s.customProviders]);

  const saveProvider = (p: Provider) => {
    const exists = s.customProviders.some((x) => x.id === p.id);
    const customProviders = exists
      ? s.customProviders.map((x) => (x.id === p.id ? p : x))
      : [...s.customProviders, p];
    update({
      customProviders,
      engineOrder: s.engineOrder.includes(p.id) ? s.engineOrder : [...s.engineOrder, p.id],
      enabledEngines: { ...s.enabledEngines, [p.id]: s.enabledEngines[p.id] ?? true },
    });
    resetCooldowns();
    setFormFor(null);
    toast(exists ? `${p.name} güncellendi` : `${p.name} eklendi`);
  };

  const removeProvider = async (p: Provider) => {
    if (!window.confirm(`${p.name} sağlayıcısı ve kayıtlı anahtarı silinsin mi?`)) return;
    const { [p.id]: _removed, ...enabled } = s.enabledEngines;
    update({
      customProviders: s.customProviders.filter((x) => x.id !== p.id),
      engineOrder: s.engineOrder.filter((x) => x !== p.id),
      enabledEngines: enabled,
      engineMode: s.engineMode === p.id ? "auto" : s.engineMode,
    });
    await api.deleteApiKey(p.keyRef).catch(() => {});
    toast(`${p.name} silindi`);
  };

  const refreshDeepl = async () => {
    setUsageErr(null);
    try {
      setUsage(await api.deeplUsage());
    } catch (e) {
      setUsage(null);
      const info = toErrorInfo(e);
      setUsageErr(info.kind === "noKey" ? null : info.message);
    }
  };

  const refreshModels = async (autoPick = false) => {
    setModelErr(null);
    try {
      const list = await api.listGeminiModels();
      setModels(list);
      if (autoPick && list.length) {
        const patch: Partial<Settings> = {};
        if (!list.some((m) => m.id === s.geminiModel)) {
          const g = pickGemini(list);
          if (g) patch.geminiModel = g;
        }
        if (!list.some((m) => m.id === s.gemmaModel)) {
          const g = pickGemma(list);
          if (g) patch.gemmaModel = g;
        }
        if (Object.keys(patch).length) update(patch);
      }
    } catch (e) {
      setModels([]);
      const info = toErrorInfo(e);
      setModelErr(info.kind === "noKey" ? null : info.message);
    }
  };

  useEffect(() => {
    refreshDeepl();
    refreshModels(true);
    cacheCount().then(setCacheN);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const move = (i: number, dir: -1 | 1) => {
    const order = [...s.engineOrder];
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    update({ engineOrder: order });
  };

  const geminiModels = models.filter((m) => m.id.startsWith("gemini"));
  const gemmaModels = models.filter((m) => m.id.startsWith("gemma"));
  const usagePct = usage && usage.characterLimit ? usage.characterCount / usage.characterLimit : 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Ayarlar</h2>
          <div className="grow" />
          <button className="icon-btn" onClick={onClose} title="Kapat (Esc)">
            <IconClose />
          </button>
        </div>

        <div className="modal-body">
          {/* ---------------------------------------------------------- Anahtarlar */}
          <section>
            <h3>Çeviri servisleri</h3>
            <p className="hint">
              Anahtarlar Windows Kimlik Bilgisi Yöneticisi'nde güvenle saklanır ve yalnızca çeviri isteği
              gönderilirken kullanılır. İkisi de kredi kartı istemeyen ücretsiz planlarla alınabilir.
            </p>

            <KeyField
              provider="deepl"
              label="DeepL API anahtarı"
              help="DeepL API Free: ayda 500.000 karakter ücretsiz. Ücretsiz anahtarlar “:fx” ile biter."
              helpUrl="https://www.deepl.com/pro-api"
              onSaved={refreshDeepl}
              toast={toast}
            />
            {usage && (
              <div className="usage">
                <div className="usage-bar">
                  <span style={{ width: `${Math.min(100, usagePct * 100)}%` }} className={usagePct > 0.9 ? "danger" : ""} />
                </div>
                <span className="small muted">
                  Bu ay: {usage.characterCount.toLocaleString("tr-TR")} / {usage.characterLimit.toLocaleString("tr-TR")} karakter
                </span>
              </div>
            )}
            {usageErr && <div className="hint error">DeepL: {usageErr}</div>}

            <KeyField
              provider="gemini"
              label="Google Gemini API anahtarı"
              help="Google AI Studio'dan kartsız alınır. Aynı anahtar hem Gemini Flash hem Gemma için kullanılır. Not: ücretsiz katmanda gönderilen metinler Google tarafından model geliştirmede kullanılabilir."
              helpUrl="https://aistudio.google.com/apikey"
              onSaved={() => refreshModels(true)}
              toast={toast}
            />
            {modelErr && <div className="hint error">Gemini: {modelErr}</div>}

            <div className="grid2">
              <label className="field">
                <span>Gemini Flash modeli</span>
                <input
                  list="gemini-models"
                  value={s.geminiModel}
                  onChange={(e) => update({ geminiModel: e.target.value.trim() })}
                  spellCheck={false}
                />
                <datalist id="gemini-models">
                  {geminiModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>Gemma modeli</span>
                <input
                  list="gemma-models"
                  value={s.gemmaModel}
                  onChange={(e) => update({ gemmaModel: e.target.value.trim() })}
                  spellCheck={false}
                />
                <datalist id="gemma-models">
                  {gemmaModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </datalist>
              </label>
            </div>
            {models.length > 0 && (
              <div className="hint">
                Anahtarınızın erişebildiği {models.length} model bulundu.{" "}
                <button className="link-btn" onClick={() => refreshModels(false)}>
                  Listeyi yenile
                </button>
              </div>
            )}

            <div className="custom-providers">
              <div className="key-head">
                <strong>Ek sağlayıcılar</strong>
                <span className="small muted">Claude, DeepSeek, OpenRouter, Groq, Ollama ve OpenAI uyumlu her servis</span>
              </div>
              {s.customProviders.length === 0 && formFor === null && (
                <div className="hint">Henüz ek sağlayıcı yok.</div>
              )}
              {s.customProviders.map((p) =>
                formFor === p.id ? (
                  <ProviderForm
                    key={p.id}
                    settings={s}
                    editing={p}
                    onSave={saveProvider}
                    onCancel={() => setFormFor(null)}
                  />
                ) : (
                  <div key={p.id} className="provider-card">
                    <span className={`badge engine-${p.kind}`}>{p.name}</span>
                    <div className="provider-meta">
                      <span>{p.model}</span>
                      <span className="muted small">
                        {KIND_LABEL[p.kind]}
                        {p.baseUrl ? ` · ${p.baseUrl}` : ""}
                      </span>
                    </div>
                    {customKeys[p.id] === false && <span className="badge warn">Anahtar yok</span>}
                    <div className="grow" />
                    <button className="btn sm" onClick={() => setFormFor(p.id)}>
                      Düzenle
                    </button>
                    <button className="btn sm" onClick={() => removeProvider(p)}>
                      Sil
                    </button>
                  </div>
                ),
              )}
              {formFor === "new" ? (
                <ProviderForm settings={s} onSave={saveProvider} onCancel={() => setFormFor(null)} />
              ) : (
                <button className="btn sm" onClick={() => setFormFor("new")} disabled={formFor !== null}>
                  + Sağlayıcı ekle
                </button>
              )}
            </div>
          </section>

          {/* ---------------------------------------------------------- Çeviri tercihleri */}
          <section>
            <h3>Çeviri sırası ve tercihler</h3>
            <p className="hint">
              <b>Otomatik</b> modda üstteki motor denenir; kotası dolarsa, anahtarı yoksa veya hata verirse
              sıradakine geçilir.
            </p>
            <div className="engine-order">
              {s.engineOrder.map((e, i) => {
                const prov = getProvider(s, e);
                if (!prov) return null;
                return (
                <div key={e} className={`engine-row ${s.enabledEngines[e] !== false ? "" : "disabled"}`}>
                  <span className="order-num">{i + 1}</span>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={s.enabledEngines[e] !== false}
                      onChange={(ev) => update({ enabledEngines: { ...s.enabledEngines, [e]: ev.target.checked } })}
                    />
                    <span className={`badge engine-${prov.kind}`}>{prov.name}</span>
                  </label>
                  <span className="small muted">
                    {e === "deepl" && "Hızlı, Türkçede en iyi klasik motor"}
                    {e === "gemini" && `${s.geminiModel} · bağlamı anlayarak çevirir`}
                    {e === "gemma" && `${s.gemmaModel} · yüksek ücretsiz limit`}
                    {!prov.builtin && prov.model}
                  </span>
                  <div className="grow" />
                  <button className="icon-btn xs" onClick={() => move(i, -1)} disabled={i === 0} title="Yukarı">
                    <IconArrowUp size={14} />
                  </button>
                  <button
                    className="icon-btn xs"
                    onClick={() => move(i, 1)}
                    disabled={i === s.engineOrder.length - 1}
                    title="Aşağı"
                  >
                    <IconArrowDown size={14} />
                  </button>
                </div>
                );
              })}
            </div>

            <div className="grid2">
              <label className="field">
                <span>Varsayılan çeviri motoru</span>
                <select value={s.engineMode} onChange={(e) => update({ engineMode: e.target.value as EngineMode })}>
                  <option value="auto">Otomatik (yukarıdaki sırayla)</option>
                  {allProviders(s).map((p) => (
                    <option key={p.id} value={p.id}>
                      Yalnızca {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Hedef dil</span>
                <select value={s.targetLang} onChange={(e) => update({ targetLang: e.target.value })}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check line">
              <input type="checkbox" checked={s.autoTranslate} onChange={(e) => update({ autoTranslate: e.target.checked })} />
              Metni seçer seçmez çevir (düğmeye basmadan)
            </label>
            <label className="check line">
              <input type="checkbox" checked={s.useContext} onChange={(e) => update({ useContext: e.target.checked })} />
              Daha doğru çeviri için seçimin çevresindeki metni bağlam olarak gönder
            </label>
          </section>

          {/* ---------------------------------------------------------- Görünüm */}
          <section>
            <h3>Görünüm</h3>
            <div className="theme-grid">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`theme-card ${s.theme === t.id ? "on" : ""}`}
                  onClick={() => update({ theme: t.id })}
                >
                  <span className="theme-swatch" style={{ background: t.swatch }}>
                    <span style={{ background: t.pageBg, color: t.pageFg }}>Aa</span>
                  </span>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="field">
              <span>PDF sayfa renkleri</span>
              <div className="seg">
                {(
                  [
                    ["original", "Orijinal"],
                    ["theme", "Temaya uydur"],
                    ["custom", "Özel renk"],
                  ] as [PageMode, string][]
                ).map(([id, label]) => (
                  <button key={id} className={s.pageMode === id ? "on" : ""} onClick={() => update({ pageMode: id })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {s.pageMode === "custom" && (
              <div className="custom-colors">
                <label className="color-field">
                  <input type="color" value={s.customBg} onChange={(e) => update({ customBg: e.target.value })} />
                  Arka plan
                </label>
                <label className="color-field">
                  <input type="color" value={s.customFg} onChange={(e) => update({ customFg: e.target.value })} />
                  Yazı
                </label>
                <div className="presets">
                  {PAGE_PRESETS.map((pr) => (
                    <button
                      key={pr.label}
                      className="preset"
                      style={{ background: pr.bg, color: pr.fg }}
                      onClick={() => update({ customBg: pr.bg, customFg: pr.fg })}
                      title={pr.label}
                    >
                      Aa
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="hint">
              “Temaya uydur” ve “Özel renk”, PDF'teki yazı ve arka planı seçilen renklere boyar; göz yormadan
              okumak için idealdir. Markdown dosyaları da aynı renkleri kullanır.
            </p>
          </section>

          {/* ---------------------------------------------------------- Veriler */}
          <section>
            <h3>Veriler ve kısayollar</h3>
            <div className="row">
              <span>Çeviri önbelleği: {cacheN ?? "…"} kayıt</span>
              <div className="grow" />
              <button
                className="btn"
                onClick={async () => {
                  await cacheClear();
                  setCacheN(0);
                  toast("Önbellek temizlendi");
                }}
              >
                Önbelleği temizle
              </button>
            </div>
            <div className="clear-box">
              <strong className="small">Okuma kayıtlarını temizle</strong>
              <span className="small muted">PDF ve Markdown dosyalarınız silinmez.</span>
              <div className="row wrap">
                <label className="check small">
                  <input
                    type="checkbox"
                    checked={clearOpts.recent}
                    onChange={(e) => setClearOpts({ ...clearOpts, recent: e.target.checked })}
                  />
                  Son okunanlar
                </label>
                <label className="check small">
                  <input
                    type="checkbox"
                    checked={clearOpts.progress}
                    onChange={(e) => setClearOpts({ ...clearOpts, progress: e.target.checked })}
                  />
                  Kaldığı yerler / ilerleme
                </label>
                <label className="check small">
                  <input
                    type="checkbox"
                    checked={clearOpts.translations}
                    onChange={(e) => setClearOpts({ ...clearOpts, translations: e.target.checked })}
                  />
                  Çeviri geçmişi
                </label>
                <div className="grow" />
                <button
                  className="btn sm danger"
                  disabled={!clearOpts.recent && !clearOpts.progress && !clearOpts.translations}
                  onClick={() => {
                    if (window.confirm("Seçilen okuma kayıtları tüm kitaplar için silinsin mi?")) onClearAll(clearOpts);
                  }}
                >
                  Tümünü sil
                </button>
              </div>
            </div>
            <div className="shortcuts">
              <div><kbd>Ctrl</kbd>+<kbd>T</kbd> Seçili metni çevir</div>
              <div><kbd>Ctrl</kbd>+<kbd>J</kbd> Çeviri geçmişi paneli</div>
              <div><kbd>Ctrl</kbd>+<kbd>F</kbd> PDF içinde ara</div>
              <div><kbd>Ctrl</kbd>+<kbd>D</kbd> Kalemle çiz (<kbd>Ctrl</kbd>+<kbd>Z</kbd> geri al)</div>
              <div><kbd>Ctrl</kbd>+<kbd>O</kbd> Klasör aç</div>
              <div><kbd>Ctrl</kbd>+<kbd>B</kbd> Kenar çubuğu</div>
              <div><kbd>Ctrl</kbd>+<kbd>+</kbd>/<kbd>−</kbd> Yakınlaştır / uzaklaştır</div>
              <div><kbd>Ctrl</kbd>+<kbd>0</kbd> Genişliğe sığdır</div>
              <div><kbd>Ctrl</kbd>+<kbd>,</kbd> Ayarlar</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
