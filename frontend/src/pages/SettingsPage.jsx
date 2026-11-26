import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, users } from "../api";
import { disableWebPush, enableWebPush, isWebPushEnabled, supportsWebPush } from "../api/push";

const SETTINGS_KEY = "spark-chat-defaults";
const DEFAULTS = { muted: false, sound: true, shareReads: true, sharePresence: true };
const SECTIONS = [
  { id: "notifications", label: "Уведомления", icon: "◉" },
  { id: "chats", label: "Чаты", icon: "▤" },
  { id: "privacy", label: "Конфиденциальность", icon: "◇" },
  { id: "blocked", label: "Чёрный список", icon: "⊘" },
  { id: "account", label: "Аккаунт", icon: "◌" },
];

function loadDefaults() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

function SettingSwitch({ label, description, checked, onChange }) {
  return (
    <label className="settings-switch">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-switch__track" aria-hidden="true" />
    </label>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const user = auth.getCurrentUser();
  const [section, setSection] = useState("notifications");
  const [defaults, setDefaults] = useState(loadDefaults);
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [pushEnabled, setPushEnabled] = useState(() => isWebPushEnabled(user?.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profilePrivacy, setProfilePrivacy] = useState({
    visibility: { avatar: "everyone", bio: "everyone", birth_date: "everyone" },
    exceptions: { avatar: [], bio: [], birth_date: [] },
  });
  const [exceptionInputs, setExceptionInputs] = useState({ avatar: "", bio: "", birth_date: "" });
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState("");
  const [accountForm, setAccountForm] = useState({ bio: "", birth_date: "" });
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");

  useEffect(() => {
    users.getMe().then((profile) => {
      setProfilePrivacy({
        visibility: { avatar: "everyone", bio: "everyone", birth_date: "everyone", ...profile.profile_visibility },
        exceptions: { avatar: [], bio: [], birth_date: [], ...profile.profile_exceptions },
      });
      setAccountForm({ bio: profile.bio || "", birth_date: profile.birth_date || "" });
    }).catch(() => setPrivacyMessage("Не удалось загрузить параметры профиля."));
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
  }, [defaults]);

  const update = (key, value) => setDefaults((current) => ({ ...current, [key]: value }));
  const togglePush = async () => {
    setBusy(true);
    setError("");
    try {
      let nextPermission = permission;
      if (nextPermission === "default") {
        nextPermission = await Notification.requestPermission();
        setPermission(nextPermission);
      }
      if (nextPermission !== "granted" || !supportsWebPush()) return;
      if (pushEnabled) await disableWebPush(user?.id);
      else await enableWebPush(user?.id);
      setPushEnabled(isWebPushEnabled(user?.id));
    } catch {
      setError("Не удалось изменить настройки уведомлений. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    await auth.logoutUser();
    navigate("/login", { replace: true });
  };
  const addException = (field) => {
    const tag = exceptionInputs[field].trim().replace(/^@/, "");
    if (!tag || profilePrivacy.exceptions[field].some((item) => item.toLowerCase() === tag.toLowerCase())) return;
    setProfilePrivacy((current) => ({
      ...current,
      exceptions: { ...current.exceptions, [field]: [...current.exceptions[field], tag] },
    }));
    setExceptionInputs((current) => ({ ...current, [field]: "" }));
  };
  const savePrivacy = async () => {
    setPrivacyBusy(true);
    setPrivacyMessage("");
    try {
      await users.updateMe({
        profile_visibility: profilePrivacy.visibility,
        profile_exceptions: profilePrivacy.exceptions,
      });
      setPrivacyMessage("Настройки конфиденциальности сохранены.");
    } catch (saveError) {
      const detail = saveError.response?.data?.detail;
      setPrivacyMessage(typeof detail === "string" ? detail : "Не удалось сохранить настройки конфиденциальности.");
    } finally {
      setPrivacyBusy(false);
    }
  };
  const saveAccount = async () => {
    setAccountBusy(true);
    setAccountMessage("");
    try {
      await users.updateMe({ bio: accountForm.bio.trim() || null, birth_date: accountForm.birth_date || null });
      setAccountMessage("Данные профиля сохранены.");
    } catch {
      setAccountMessage("Не удалось сохранить данные профиля.");
    } finally {
      setAccountBusy(false);
    }
  };

  const sectionTitle = SECTIONS.find((item) => item.id === section)?.label;
  const notificationLabel = permission === "unsupported"
    ? "Уведомления недоступны в этом браузере"
    : permission === "denied"
      ? "Уведомления заблокированы в браузере"
      : permission === "default"
        ? "Разрешить уведомления"
        : pushEnabled ? "Отключить push-уведомления" : "Включить push-уведомления";

  return (
    <main className="settings-page">
      <header className="settings-page__intro">
        <span className="settings-page__eyebrow">Spark</span>
        <h1>Настройки</h1>
        <p>Управляйте уведомлениями, параметрами чатов и аккаунтом.</p>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Разделы настроек">
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" className={section === item.id ? "settings-nav__item settings-nav__item--active" : "settings-nav__item"} onClick={() => setSection(item.id)} aria-current={section === item.id ? "page" : undefined}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>

        <section className="settings-panel" aria-labelledby="settings-title">
          <div className="settings-panel__heading">
            <h2 id="settings-title">{sectionTitle}</h2>
            <p>{section === "account" ? "Управление текущим аккаунтом" : "Настройки сохраняются в этом браузере"}</p>
          </div>

          {section === "notifications" && <div className="settings-group">
            <h3>Браузерные уведомления</h3>
            <p className="settings-group__description">Получайте уведомления о новых сообщениях, даже когда Spark не открыт.</p>
            <button type="button" className="settings-action" onClick={togglePush} disabled={busy || permission === "denied" || permission === "unsupported" || (permission === "granted" && !supportsWebPush())}>
              {busy ? "Обновление…" : notificationLabel}
            </button>
            {permission === "denied" && <p className="settings-hint">Разрешите уведомления в настройках сайта вашего браузера.</p>}
            {error && <p className="settings-error" role="alert">{error}</p>}
          </div>}

          {section === "chats" && <div className="settings-group">
            <h3>Настройки по умолчанию для чатов</h3>
            <p className="settings-group__description">Применяются к чатам без собственных настроек. Индивидуальные настройки доступны в меню чата.</p>
            <SettingSwitch label="Без уведомлений" description="Не показывать уведомления о новых сообщениях" checked={defaults.muted} onChange={(value) => update("muted", value)} />
            <SettingSwitch label="Звук сообщений" description="Воспроизводить звук при новом сообщении" checked={defaults.sound} onChange={(value) => update("sound", value)} />
            <SettingSwitch label="Показывать прочтение" description="Делиться отметками о прочтении сообщений" checked={defaults.shareReads} onChange={(value) => update("shareReads", value)} />
            <SettingSwitch label="Показывать статус в сети" description="Делиться своим присутствием в чате" checked={defaults.sharePresence} onChange={(value) => update("sharePresence", value)} />
          </div>}

          {section === "privacy" && <div className="settings-group">
            <h3>Кто видит данные профиля</h3>
            <p className="settings-group__description">Исключения скрывают выбранное поле даже от аудитории, которой оно разрешено.</p>
            {[
              ["avatar", "Фото профиля"],
              ["bio", "О себе"],
              ["birth_date", "Дата рождения"],
            ].map(([field, label]) => <div className="privacy-field" key={field}>
              <div className="privacy-field__top">
                <strong>{label}</strong>
                <select aria-label={`Кто видит: ${label}`} value={profilePrivacy.visibility[field]} onChange={(event) => setProfilePrivacy((current) => ({ ...current, visibility: { ...current.visibility, [field]: event.target.value } }))}>
                  <option value="everyone">Все</option>
                  <option value="friends">Только контакты</option>
                  <option value="nobody">Никто</option>
                </select>
              </div>
              <div className="privacy-field__except">
                <strong>Кроме</strong>
                <div className="privacy-field__add">
                  <input aria-label={`Исключить пользователя для: ${label}`} value={exceptionInputs[field]} onChange={(event) => setExceptionInputs((current) => ({ ...current, [field]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addException(field); } }} placeholder="Тег пользователя" />
                  <button type="button" onClick={() => addException(field)}>Добавить</button>
                </div>
              </div>
              {profilePrivacy.exceptions[field].length > 0 && <ul className="privacy-field__tags">
                {profilePrivacy.exceptions[field].map((tag) => <li key={tag}>@{tag}<button type="button" aria-label={`Удалить исключение ${tag} для ${label}`} onClick={() => setProfilePrivacy((current) => ({ ...current, exceptions: { ...current.exceptions, [field]: current.exceptions[field].filter((item) => item !== tag) } }))}>×</button></li>)}
              </ul>}
            </div>)}
            <button type="button" className="settings-action" disabled={privacyBusy} onClick={savePrivacy}>{privacyBusy ? "Сохранение…" : "Сохранить конфиденциальность"}</button>
            {privacyMessage && <p className={privacyMessage.startsWith("Не удалось") ? "settings-error" : "settings-hint"} role="status">{privacyMessage}</p>}
          </div>}

          {section === "blocked" && <div className="settings-empty">
            <span aria-hidden="true">⊘</span>
            <h3>Чёрный список пуст</h3>
            <p>В этом аккаунте пока нет заблокированных пользователей.</p>
          </div>}

          {section === "account" && <div className="settings-group settings-account">
            <div className="settings-account__identity">
              <span className="settings-account__avatar">{user?.username?.[0]?.toUpperCase() || "?"}</span>
              <span><strong>{user?.username || "Пользователь"}</strong><small>@{user?.tag || ""}</small></span>
            </div>
            <div className="settings-account__row"><span>Email</span><strong>{user?.email || "—"}</strong></div>
            <label className="settings-account__field">
              <span>О себе</span>
              <textarea value={accountForm.bio} maxLength={500} rows={4} onChange={(event) => setAccountForm((current) => ({ ...current, bio: event.target.value }))} placeholder="Расскажите немного о себе" />
            </label>
            <label className="settings-account__field">
              <span>Дата рождения</span>
              <input type="date" value={accountForm.birth_date} onChange={(event) => setAccountForm((current) => ({ ...current, birth_date: event.target.value }))} />
            </label>
            <button type="button" className="settings-action" disabled={accountBusy} onClick={saveAccount}>{accountBusy ? "Сохранение…" : "Сохранить данные профиля"}</button>
            {accountMessage && <p className={accountMessage.startsWith("Не удалось") ? "settings-error" : "settings-hint"} role="status">{accountMessage}</p>}
            <button type="button" className="settings-action settings-action--danger" onClick={logout}>Выйти из аккаунта</button>
          </div>}
        </section>
      </div>
    </main>
  );
}
