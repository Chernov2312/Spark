import { useEffect, useRef, useState } from "react";

const ROLE_LABELS = { owner: "Владелец", moderator: "Модератор", member: "Участник" };

export function MemberRole({ role }) {
  return <span className={`member-role member-role--${role || "member"}`}>{ROLE_LABELS[role] || ROLE_LABELS.member}</span>;
}

export function MemberAvatar({ member, url, large = false }) {
  const avatarUrl = url || member.avatar_urls?.at(-1) || member.avatar_url;
  const [failedUrl, setFailedUrl] = useState(null);
  const initials = (member.username || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <span className={`member-avatar${large ? " member-avatar--large" : ""}`} aria-hidden="true">
      {avatarUrl && failedUrl !== avatarUrl
        ? <img src={avatarUrl} alt="" onError={() => setFailedUrl(avatarUrl)} />
        : initials}
    </span>
  );
}

export default function ChatMemberProfile({ member, chatTitle, isMe, online, onClose }) {
  const dialogRef = useRef(null);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const photos = member.avatar_urls || [];

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog.querySelector("button")?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialog.querySelectorAll("button:not(:disabled)"));
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop member-profile-backdrop" onClick={onClose}>
      <section ref={dialogRef} className="member-profile" role="dialog" aria-modal="true" aria-labelledby="member-profile-name" onClick={(event) => event.stopPropagation()}>
        <div className="member-profile__cover">
          <span>Профиль участника</span>
          <button type="button" className="member-profile__close" aria-label="Закрыть профиль" onClick={onClose}>×</button>
        </div>
        <div className="member-profile__body">
          <MemberAvatar member={member} url={selectedPhoto} large />
          <h2 id="member-profile-name">{member.username}{isMe && <small>Это вы</small>}</h2>
          <p className="member-profile__tag">@{member.tag || member.username}</p>
          <div className="member-profile__badges">
            <MemberRole role={member.role} />
            {online && <span className="member-profile__online">В сети</span>}
          </div>
          <dl className="member-profile__info">
            <div><dt>В чате</dt><dd>{chatTitle}</dd></div>
            {member.created_at && <div><dt>В Spark с</dt><dd>{new Date(member.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</dd></div>}
          </dl>
          {photos.length > 1 && <div className="member-profile__photos" aria-label="Фотографии профиля">
            {photos.map((photo, index) => <button type="button" key={photo} aria-label={`Фото профиля ${index + 1}`} aria-pressed={photo === (selectedPhoto || photos.at(-1))} onClick={() => setSelectedPhoto(photo)}>
              <img src={photo} alt="" />
            </button>)}
          </div>}
          <button type="button" className="vk-btn member-profile__done" onClick={onClose}>Вернуться в чат</button>
        </div>
      </section>
    </div>
  );
}
