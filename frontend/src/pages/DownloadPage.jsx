import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SparkLogo from "../components/SparkLogo";
import { getInstallerLinks, INSTALLER_FILES } from "../utils/appDownloads";

const platforms = [
  { id: "windows", name: "Windows", requirement: "Windows 10 и 11 · 64 бита", format: ".exe" },
  { id: "android", name: "Android", requirement: "Android 10 и новее", format: ".apk" },
];

function PlatformIcon({ platform }) {
  return (
    <span className="downloads__platform-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {platform === "windows" ? (
          <path d="M3 4.5h18v12H3zM8 20h8m-4-3.5V20" />
        ) : (
          <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.2h3" /></>
        )}
      </svg>
    </span>
  );
}

export default function DownloadPage({ installPrompt, clearInstallPrompt }) {
  const [links, setLinks] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    void getInstallerLinks(controller.signal).then((result) => {
      if (!controller.signal.aborted) setLinks(result);
    });
    return () => controller.abort();
  }, []);

  const requestInstall = async () => {
    const prompt = installPrompt;
    clearInstallPrompt();
    try { await prompt.prompt(); } catch { /* Installation steps remain available below. */ }
  };

  return (
    <main className="downloads">
      <header className="downloads__intro">
        <span className="downloads__logo"><SparkLogo size={42} alt="" /></span>
        <h1>Скачать Spark</h1>
        <p>Установите Spark на компьютер или телефон и войдите в свой аккаунт, чтобы продолжить переписку.</p>
      </header>

      <div className="downloads__grid" aria-busy={links === null}>
        {platforms.map(({ id, name, requirement, format }) => (
          <section key={id} className="downloads__card">
            <PlatformIcon platform={id} />
            <h2>{name}</h2>
            <p>{requirement}</p>
            {links?.[id] ? (
              <a className="home__btn home__btn--primary" href={links[id]} download={INSTALLER_FILES[id]}>
                Скачать для {name} <span aria-hidden="true">{format}</span>
              </a>
            ) : (
              <p className="downloads__status">{links ? "Установщик пока недоступен" : "Проверяем наличие установщика…"}</p>
            )}
          </section>
        ))}
        <section className="downloads__card">
          <PlatformIcon platform="ios" />
          <h2>iPhone и iPad</h2>
          <p>Веб-приложение на экране «Домой»</p>
          <details>
            <summary>Как установить</summary>
            <ol>
              <li>Откройте Spark в Safari и нажмите «Поделиться».</li>
              <li>Выберите «На экран “Домой”».</li>
              <li>Включите «Открывать как веб-приложение», если такой пункт есть, и нажмите «Добавить».</li>
            </ol>
          </details>
        </section>
      </div>

      <section className="downloads__browser">
        <div>
          <h2>Spark в браузере</h2>
          <p>В Chrome или Edge установку можно найти в меню браузера.</p>
        </div>
        <div className="downloads__browser-actions">
          {installPrompt && (
            <button className="home__btn" type="button" onClick={requestInstall}>Установить веб-приложение</button>
          )}
          <Link to="/chats" className="home__btn">Открыть в браузере</Link>
        </div>
      </section>
    </main>
  );
}
