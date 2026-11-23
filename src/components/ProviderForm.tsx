import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { api, toErrorInfo } from "../lib/api";
import { getLanguage } from "../lib/languages";
import { newProviderId, PRESETS, type Preset } from "../lib/providers";
import type { Provider, Settings } from "../lib/types";

const ANTHROPIC_URL = "https://api.anthropic.com";
import { IconExternal } from "./Icons";

interface Props {
  settings: Settings;
  /** Düzenlenen sağlayıcı; yoksa yeni sağlayıcı eklenir */
  editing?: Provider;
  onSave: (p: Provider) => void;
  onCancel: () => void;
}

/** Yeni sağlayıcı ekleme / düzenleme formu */
export default function ProviderForm({ settings, editing, onSave, onCancel }: Props) {
  const [id] = useState(() => editing?.id ?? newProviderId());
  const [presetId, setPresetId] = useState(editing?.preset ?? "anthropic");
  const preset: Preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[PRESETS.length - 1];
  const kind = editing?.kind === "anthropic" || editing?.kind === "openai" ? editing.kind : preset.kind;

  const [name, setName] = useState(editing?.name ?? preset.name);
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? preset.baseUrl ?? "");
  const [model, setModel] = useState(editing?.model ?? preset.model ?? "");
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [busy, setBusy] = useState<"" | "models" | "test" | "save">("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Yeni sağlayıcı için kaydedilmeden kasaya yazılan anahtarı iptalde temizlemek için
  const savedKeyForNew = useRef(false);
  const local = editing?.local ?? preset.local ?? false;

  useEffect(() => {
    if (editing) api.hasApiKey(editing.keyRef).then(setHasKey);
  }, [editing]);

  const choosePreset = (pid: string) => {
    const p = PRESETS.find((x) => x.id === pid)!;
    setPresetId(pid);
    setName(p.name);
    setBaseUrl(p.baseUrl ?? "");
    setModel(p.model ?? "");
    setModels([]);
    setMessage(null);
  };

  /** Anahtarın kilitleneceği adres (Claude için resmi adres) */
  const keyOrigin = kind === "openai" ? baseUrl.trim() : ANTHROPIC_URL;
  const originOf = (u: string) => {
    try {
      return new URL(u).origin;
    } catch {
      return "";
    }
  };
  const originChanged =
    !!editing && hasKey && kind === "openai" && originOf(baseUrl) !== originOf(editing.baseUrl ?? "");

  /** Girilen anahtarı kasaya yazar (test / model listesi için önce gerekir) */
  const storeKey = async () => {
    if (!key.trim()) return;
    await api.setApiKey(id, key.trim(), keyOrigin);
    setKey("");
    setHasKey(true);
    if (!editing) savedKeyForNew.current = true;
  };

  const needsKey = !local;
  const keyMissing = needsKey && (!hasKey || originChanged) && !key.trim();

  const fetchModels = async () => {
    setBusy("models");
    setMessage(null);
    try {
      await storeKey();
      const list = await api.listProviderModels(kind, id, kind === "openai" ? baseUrl : undefined);
      setModels(list);
      setMessage({ ok: true, text: `${list.length} model bulundu. Model alanından seçebilirsiniz.` });
      if (!model && list.length) setModel(list[0].id);
    } catch (e) {
      setMessage({ ok: false, text: toErrorInfo(e).message });
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    setMessage(null);
    try {
      await storeKey();
      const lang = getLanguage(settings.targetLang);
      const res = await api.translate({
        engine: id,
        kind,
        keyRef: id,
        baseUrl: kind === "openai" ? baseUrl : undefined,
        model,
        text: "The reader should be able to select any passage and see its translation immediately.",
        targetCode: lang.code,
        targetName: lang.llmName,
      });
      setMessage({ ok: true, text: `Çalışıyor ✓ “${res.text}”` });
    } catch (e) {
      setMessage({ ok: false, text: toErrorInfo(e).message });
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!name.trim()) return setMessage({ ok: false, text: "Bir ad girin" });
    if (kind === "openai" && !/^https?:\/\/.+/.test(baseUrl.trim()))
      return setMessage({ ok: false, text: "Geçerli bir adres girin (https://...)" });
    if (!model.trim()) return setMessage({ ok: false, text: "Model girin veya “Modelleri getir” ile seçin" });
    if (keyMissing)
      return setMessage({
        ok: false,
        text: originChanged ? "Adres değiştiği için güvenlik gereği anahtarı yeniden girin" : "API anahtarını girin",
      });
    setBusy("save");
    try {
      await storeKey();
      savedKeyForNew.current = false; // artık kalıcı
      onSave({
        id,
        kind,
        name: name.trim(),
        model: model.trim(),
        baseUrl: kind === "openai" ? baseUrl.trim().replace(/\/+$/, "") : undefined,
        keyRef: id,
        local,
        preset: presetId,
      });
    } catch (e) {
      setMessage({ ok: false, text: toErrorInfo(e).message });
      setBusy("");
    }
  };

  const cancel = () => {
    if (savedKeyForNew.current) api.deleteApiKey(id).catch(() => {});
    onCancel();
  };

  return (
    <div className="provider-form">
      <div className="pf-title">{editing ? `${editing.name} sağlayıcısını düzenle` : "Yeni sağlayıcı ekle"}</div>

      {!editing && (
        <label className="field">
          <span>Servis</span>
          <select value={presetId} onChange={(e) => choosePreset(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {preset.hint && <div className="hint">{preset.hint}</div>}

      <div className="grid2">
        <label className="field">
          <span>Görünen ad</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. DeepSeek" />
        </label>
        <label className="field">
          <span>Model</span>
          <input
            list={`models-${id}`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="ör. deepseek-chat"
            spellCheck={false}
          />
          <datalist id={`models-${id}`}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </datalist>
        </label>
      </div>

      {kind === "openai" && (
        <label className="field">
          <span>Adres (OpenAI uyumlu, genelde /v1 ile biter)</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
        </label>
      )}

      {needsKey && (
        <label className="field">
          <span>
            API anahtarı {hasKey && <span className="badge ok">Kayıtlı ✓</span>}
            {preset.keyUrl && !editing && (
              <button type="button" className="link-btn" onClick={() => openUrl(preset.keyUrl!)}>
                {" "}
                anahtar al <IconExternal size={12} />
              </button>
            )}
          </span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? "Değiştirmek için yeni anahtar girin" : "Anahtarı yapıştırın"}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
      {originChanged && !key.trim() && (
        <div className="pf-message error">Adres değişti: güvenlik gereği anahtarı yeniden girmeniz gerekiyor.</div>
      )}
      <div className="hint">
        Anahtar Windows Kimlik Bilgisi Yöneticisi'nde saklanır ve bu adrese kilitlenir; başka bir adrese
        asla gönderilmez. Anahtarınızı yalnızca güvendiğiniz servislere girin.
      </div>

      {message && <div className={`pf-message ${message.ok ? "ok" : "error"}`}>{message.text}</div>}

      <div className="row pf-actions">
        <button className="btn sm" onClick={fetchModels} disabled={!!busy || keyMissing}>
          {busy === "models" ? "Getiriliyor…" : "Modelleri getir"}
        </button>
        <button className="btn sm" onClick={test} disabled={!!busy || keyMissing || !model.trim()}>
          {busy === "test" ? "Deneniyor…" : "Bağlantıyı test et"}
        </button>
        <div className="grow" />
        <button className="btn sm" onClick={cancel} disabled={busy === "save"}>
          Vazgeç
        </button>
        <button className="btn sm primary" onClick={save} disabled={!!busy}>
          {editing ? "Kaydet" : "Ekle"}
        </button>
      </div>
    </div>
  );
}
