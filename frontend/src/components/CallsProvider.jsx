import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { auth, AUTH_EVENT } from "../api";
import CallPanel from "./CallPanel";
import { CallsContext } from "./callsContext";

export default function CallsProvider({ children }) {
  const { pathname } = useLocation();
  const [userId, setUserId] = useState(() => auth.getCurrentUser()?.id);
  const [chat, setChat] = useState(null);
  const [chatCall, setChatCall] = useState(null);
  const [dialog, setDialog] = useState(null);
  const available = Boolean(userId) && pathname !== "/call/join";
  const updateChatCall = useCallback((status) => {
    setChatCall(status);
    if (!status) return;
    setDialog((current) => {
      if (!current?.call || current.call.chat_id !== status.chat_id) return current;
      return current.call.call_id === status.call_id ? { ...current, call: status } : null;
    });
  }, []);

  useEffect(() => {
    const updateUser = () => {
      const nextUser = auth.getCurrentUser()?.id;
      if (nextUser !== userId) {
        setUserId(nextUser);
        setDialog(null);
        setChatCall(null);
      }
    };
    window.addEventListener(AUTH_EVENT, updateUser);
    window.addEventListener("storage", updateUser);
    return () => {
      window.removeEventListener(AUTH_EVENT, updateUser);
      window.removeEventListener("storage", updateUser);
    };
  }, [userId]);

  const calls = {
    available, chatCall, setChat,
    openStandalone: () => setDialog({ standalone: true }),
    openChat: () => setDialog({ standalone: false }),
    joinChat: (call) => setDialog({ standalone: false, call }),
  };
  return (
    <CallsContext.Provider value={calls}>
      {children}
      {available && (
        <CallPanel key={userId} chatId={chat?.id} chatName={chat?.name} canInvite={chat?.canInvite}
          standalone={dialog?.standalone} joinRequest={dialog?.call} open={Boolean(dialog)}
          onChatCallChange={updateChatCall} onClose={() => setDialog(null)} />
      )}
    </CallsContext.Provider>
  );
}
