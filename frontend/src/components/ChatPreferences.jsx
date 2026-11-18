import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function PreferenceSwitch({ label, description, checked, onChange }) {
  return (
    <label className="chat-settings__option">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="chat-settings__switch" aria-hidden="true" />
    </label>
  );
}

export default function ChatPreferences({ preferences, onChange }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({});
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const update = (field, value) => onChange((current) => ({ ...current, [field]: value }));

  useLayoutEffect(() => {
    if (!open) return;
    const place = (event) => {
      if (event && panelRef.current?.contains(event.target)) return;
      const rect = triggerRef.current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const width = Math.min(360, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const upwards = below < 420 && above > below;
      setPosition({
        width,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        maxHeight: Math.max(120, upwards ? above : below),
        ...(upwards ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector("button")?.focus();
    const dismissOutside = (event) => {
      if (!panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    };
    const dismissEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [open]);

  const requestNotifications = async () => {
    setPermissionBusy(true);
    setPermissionError("");
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermissionError("Не удалось включить уведомления. Проверьте настройки браузера.");
    } finally {
      setPermissionBusy(false);
    }
  };

  return (
    <div className="chat-settings">
      <button ref={triggerRef} type="button" className="chat-settings__trigger" aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? panelId : undefined} onClick={() => setOpen((current) => !current)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--bg-elevated)" /><circle cx="15" cy="17" r="3" fill="var(--bg-elevated)" /></svg>
        Настройки чата
        <svg className="chat-settings__chevron" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
      </button>
      {open && createPortal(
        <section ref={panelRef} id={panelId} className="chat-settings__panel" style={position} role="dialog" aria-labelledby={`${panelId}-title`}>
          <div className="chat-settings__heading">
            <div><h3 id={`${panelId}-title`}>Настройки чата</h3><p>Настройте общение под себя</p></div>
            <button type="button" className="chat-settings__close" aria-label="Закрыть настройки чата" onClick={close}>×</button>
          </div>
          <div className="chat-settings__group">
            <h4>Оформление</h4>
            <div className="chat-settings__colors">
              <label><input type="color" aria-label="Цвет чата" value={preferences.color || "#64748b"} onChange={(event) => update("color", event.target.value)} /><span>Цвет чата</span></label>
              <label><input type="color" aria-label="Фон" value={preferences.background || "#ffffff"} onChange={(event) => update("background", event.target.value)} /><span>Фон</span></label>
            </div>
          </div>
          <div className="chat-settings__group">
            <h4>Уведомления</h4>
            <PreferenceSwitch label="Без уведомлений" description="Тихий режим для этого чата" checked={preferences.muted} onChange={(value) => update("muted", value)} />
            <PreferenceSwitch label="Звук" description="Звук новых сообщений" checked={preferences.sound} onChange={(value) => update("sound", value)} />
          </div>
          <div className="chat-settings__group">
            <h4>Приватность</h4>
            <PreferenceSwitch label="Показывать прочтение" description="Участники увидят, что вы прочитали сообщения" checked={preferences.shareReads} onChange={(value) => update("shareReads", value)} />
            <PreferenceSwitch label="Показывать статус в сети" description="Делиться своим присутствием в чате" checked={preferences.sharePresence} onChange={(value) => update("sharePresence", value)} />
          </div>
          <div className="chat-settings__footer">
            <button type="button" className="chat-settings__notifications" disabled={permissionBusy || permission !== "default"} onClick={requestNotifications}>
              {permissionBusy ? "Запрос разрешения…" : permission === "granted" ? "Уведомления разрешены" : permission === "denied" ? "Уведомления заблокированы" : permission === "unsupported" ? "Уведомления недоступны" : "Включить уведомления"}
            </button>
            <p>{permission === "denied" ? "Разрешите их в настройках сайта в браузере." : "Сохраняется автоматически на этом устройстве."}</p>
            {permissionError && <p className="chat-settings__error" role="alert">{permissionError}</p>}
          </div>
        </section>, document.body,
      )}
    </div>
  );
}
