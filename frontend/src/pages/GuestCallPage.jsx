import { useEffect, useState } from "react";
import CallPanel from "../components/CallPanel";

export default function GuestCallPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("invite"));
  const [open, setOpen] = useState(Boolean(token));
  useEffect(() => {
    if (token) history.replaceState(history.state, "", window.location.pathname + window.location.search);
  }, [token]);

  return (
    <main className="page-simple">
      <h1>Гостевой звонок</h1>
      {token && open ? (
        <CallPanel open guestToken={token} onClose={() => setOpen(false)} />
      ) : (
        <p>{token ? "Вы покинули звонок." : "Откройте ссылку-приглашение, чтобы подключиться к звонку."}</p>
      )}
    </main>
  );
}
