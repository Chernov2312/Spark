import { useCallback, useEffect, useRef, useState } from "react";

import { createCallInvite, createCallSocket, revokeCallInvite } from "../api/calls";

const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function stopCallResources(peers, localStreamRef) {
  for (const connection of peers.values()) connection.close();
  peers.clear();
  localStreamRef.current?.getTracks().forEach((track) => track.stop());
  localStreamRef.current = null;
}

function MediaTile({ stream, label, local = false }) {
  const mediaRef = useRef(null);
  const hasVideo = stream.getVideoTracks().length > 0;

  useEffect(() => {
    const mediaElement = mediaRef.current;
    if (!mediaElement) return undefined;
    mediaElement.srcObject = stream;
    const playback = mediaElement.play?.();
    playback?.catch(() => {});
    return () => {
      mediaElement.srcObject = null;
    };
  }, [stream, hasVideo]);

  return (
    <div className={`call-tile ${local ? "call-tile--local" : ""}`}>
      {hasVideo ? (
        <video ref={mediaRef} autoPlay playsInline muted={local} />
      ) : (
        <>
          <div className="call-tile__avatar" aria-hidden="true">
            {(label || "?").slice(0, 1).toUpperCase()}
          </div>
          <audio ref={mediaRef} autoPlay muted={local} />
        </>
      )}
      <span className="call-tile__name">{local ? "Вы" : label}</span>
    </div>
  );
}

export default function CallPanel({ chatId, chatName, open, onClose, canInvite, guestToken }) {
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [phase, setPhase] = useState("idle");
  const [incomingCall, setIncomingCall] = useState(null);
  const [callId, setCallId] = useState(null);
  const [callChatId, setCallChatId] = useState(null);
  const [callMedia, setCallMedia] = useState("audio");
  const [callerName, setCallerName] = useState("");
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [callError, setCallError] = useState("");
  const [mediaPending, setMediaPending] = useState(false);
  const [invite, setInvite] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const activeCallRef = useRef({ callId: null, chatId: null, media: "audio" });
  const incomingCallRef = useRef(null);
  const mediaAttemptRef = useRef(0);
  const pendingActionRef = useRef(null);
  const closePanelRef = useRef(onClose);

  useEffect(() => {
    closePanelRef.current = onClose;
  }, [onClose]);

  const releaseMedia = useCallback(() => {
    mediaAttemptRef.current += 1;
    pendingActionRef.current = null;
    for (const connection of peersRef.current.values()) connection.close();
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStreams({});
    setParticipants([]);
    setCallId(null);
    setCallChatId(null);
    setIncomingCall(null);
    setElapsedSeconds(0);
    setMuted(false);
    setCameraEnabled(true);
    setMediaPending(false);
    setInvite(null);
    setPhase("idle");
    activeCallRef.current = { callId: null, chatId: null, media: "audio" };
    incomingCallRef.current = null;
  }, []);

  const endCall = useCallback((notifyServer = true) => {
    const active = activeCallRef.current;
    if (notifyServer && active.callId) {
      socketRef.current?.send("call:end", { call_id: active.callId });
    }
    releaseMedia();
  }, [releaseMedia]);

  const addRemoteParticipant = useCallback((participant) => {
    if (!participant?.peer_id) return;
    setParticipants((current) => [
      ...current.filter((item) => item.peer_id !== participant.peer_id),
      participant,
    ]);
  }, []);

  const createPeerConnection = useCallback(async (peerId) => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({
      iceServers: iceServersRef.current,
    });
    localStreamRef.current?.getTracks().forEach((track) => {
      connection.addTrack(track, localStreamRef.current);
    });
    connection.onicecandidate = ({ candidate }) => {
      const active = activeCallRef.current;
      if (candidate && active.callId) {
        socketRef.current?.send("rtc:ice", {
          call_id: active.callId,
          target_id: peerId,
          candidate,
        });
      }
    };
    connection.ontrack = ({ streams, track }) => {
      const stream = streams[0] || new MediaStream([track]);
      setRemoteStreams((current) => ({ ...current, [peerId]: stream }));
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        setPhase("connected");
      }
      if (connection.connectionState === "failed") {
        setCallError("Не удалось установить соединение. Проверьте сеть и TURN-сервер.");
      }
    };
    peersRef.current.set(peerId, connection);
    return connection;
  }, []);

  const applyPendingCandidates = useCallback(async (peerId, connection) => {
    const candidates = pendingCandidatesRef.current.get(peerId) || [];
    pendingCandidatesRef.current.delete(peerId);
    for (const candidate of candidates) {
      await connection.addIceCandidate(candidate);
    }
  }, []);

  const handleSocketEvent = useCallback(async (event, data) => {
    if (event === "auth:ok") {
      setSocketStatus("ready");
      if (!activeCallRef.current.callId && !incomingCallRef.current) setCallError("");
      if (Array.isArray(data.ice_servers) && data.ice_servers.length) {
        iceServersRef.current = data.ice_servers;
      }
      return;
    }
    if (event === "auth:error") {
      setSocketStatus("unauthorized");
      setCallError(data.message || "Не удалось подключиться к сервису звонков.");
      return;
    }
    if (event === "call:incoming") {
      if (activeCallRef.current.callId || pendingActionRef.current) return;
      setIncomingCall(data);
      incomingCallRef.current = data;
      setCallMedia(data.media || "audio");
      setCallChatId(data.chat_id);
      setCallerName(data.caller_name || "Участник чата");
      setCallError("");
      setPhase("incoming");
      return;
    }
    if (event === "call:started") {
      pendingActionRef.current = null;
      setMediaPending(false);
      setCallId(data.call_id);
      setCallChatId(data.chat_id);
      setCallMedia(data.media || "audio");
      activeCallRef.current = {
        callId: data.call_id,
        chatId: data.chat_id,
        media: data.media || "audio",
      };
      if (Array.isArray(data.ice_servers) && data.ice_servers.length) {
        iceServersRef.current = data.ice_servers;
      }
      setPhase("outgoing");
      return;
    }
    const activeId = activeCallRef.current.callId || incomingCallRef.current?.call_id;
    if (event === "call:error") {
      if (pendingActionRef.current) releaseMedia();
      setCallError(data.message || "Не удалось выполнить действие со звонком.");
      return;
    }
    if (!activeId || data.call_id !== activeId) return;
    if (event === "call:accepted") {
      if (Array.isArray(data.ice_servers)) {
        iceServersRef.current = data.ice_servers;
        pendingActionRef.current = null;
        setMediaPending(false);
        incomingCallRef.current = null;
        setIncomingCall(null);
      }
      setPhase((current) => current === "connected" ? current : "connecting");
      return;
    }
    if (event === "call:peer_joined") {
      addRemoteParticipant(data);
      setPhase((current) => current === "connected" ? current : "connecting");
      if (data.should_offer) {
        const connection = await createPeerConnection(data.peer_id);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        socketRef.current?.send("rtc:offer", {
          call_id: activeCallRef.current.callId,
          target_id: data.peer_id,
          sdp: connection.localDescription,
        });
      }
      return;
    }
    if (event === "rtc:offer") {
      const connection = await createPeerConnection(data.from_id);
      await connection.setRemoteDescription(data.sdp);
      await applyPendingCandidates(data.from_id, connection);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      socketRef.current?.send("rtc:answer", {
        call_id: activeCallRef.current.callId,
        target_id: data.from_id,
        sdp: connection.localDescription,
      });
      return;
    }
    if (event === "rtc:answer") {
      const connection = peersRef.current.get(data.from_id);
      if (connection) {
        await connection.setRemoteDescription(data.sdp);
        await applyPendingCandidates(data.from_id, connection);
      }
      return;
    }
    if (event === "rtc:ice") {
      const connection = peersRef.current.get(data.from_id);
      if (!connection || !connection.remoteDescription) {
        const pending = pendingCandidatesRef.current.get(data.from_id) || [];
        pendingCandidatesRef.current.set(data.from_id, [...pending, data.candidate]);
      } else {
        await connection.addIceCandidate(data.candidate);
      }
      return;
    }
    if (event === "call:peer_left") {
      peersRef.current.get(data.peer_id)?.close();
      peersRef.current.delete(data.peer_id);
      pendingCandidatesRef.current.delete(data.peer_id);
      setRemoteStreams((current) => {
        const next = { ...current };
        delete next[data.peer_id];
        return next;
      });
      setParticipants((current) => current.filter((item) => item.peer_id !== data.peer_id));
      if (!peersRef.current.size) setPhase("outgoing");
      return;
    }
    if (event === "call:ended") {
      endCall(false);
      if (data.reason === "timeout" && !guestToken) setCallError("Вызов остался без ответа.");
      else closePanelRef.current?.();
      return;
    }
    if (event === "call:declined") {
      setCallError(data.message || "Собеседник отклонил звонок.");
      return;
    }
  }, [addRemoteParticipant, applyPendingCandidates, createPeerConnection, endCall, guestToken, releaseMedia]);

  useEffect(() => {
    const peers = peersRef.current;
    const streamRef = localStreamRef;
    let events = Promise.resolve();
    let closed = false;
    const socket = createCallSocket({
      inviteToken: guestToken,
      onEvent: (event, data) => {
        events = events
          .then(() => { if (!closed) return handleSocketEvent(event, data); })
          .catch((error) => {
            if (!closed) setCallError(error.message || "Ошибка соединения во время звонка.");
          });
      },
      onStatus: (status) => {
        setSocketStatus(status);
        if (status === "disconnected") {
          releaseMedia();
          setCallError("Соединение со звонком потеряно.");
        }
      },
    });
    socketRef.current = socket;
    return () => {
      closed = true;
      mediaAttemptRef.current += 1;
      socket.close();
      stopCallResources(peers, streamRef);
    };
  }, [guestToken, handleSocketEvent, releaseMedia]);

  useEffect(() => {
    if (phase !== "connected") return undefined;
    const timer = setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const acquireMedia = async (media) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Браузер не поддерживает доступ к микрофону и камере.");
    }
    const attempt = ++mediaAttemptRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: media === "video",
    });
    if (attempt !== mediaAttemptRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setCallMedia(media);
    return true;
  };

  const startCall = async (media) => {
    if (socketStatus !== "ready" || !chatId || mediaPending) return;
    setCallError("");
    setMediaPending(true);
    pendingActionRef.current = "start";
    try {
      if (!await acquireMedia(media)) return;
      setCallChatId(chatId);
      setCallerName(chatName || "Звонок в чате");
      setPhase("outgoing");
      if (!socketRef.current?.send("call:start", { chat_id: chatId, media })) {
        throw new Error("Сервис звонков недоступен. Попробуйте подключиться снова.");
      }
    } catch (error) {
      releaseMedia();
      setCallError(error.message || "Не удалось получить доступ к микрофону или камере.");
    }
  };

  const acceptCall = async () => {
    const incoming = incomingCallRef.current;
    if (!incoming || mediaPending) return;
    setCallError("");
    setMediaPending(true);
    pendingActionRef.current = "accept";
    try {
      if (!await acquireMedia(incoming.media || "audio")) return;
      setCallId(incoming.call_id);
      setCallChatId(incoming.chat_id);
      setCallerName(incoming.caller_name || "Участник чата");
      activeCallRef.current = {
        callId: incoming.call_id,
        chatId: incoming.chat_id,
        media: incoming.media || "audio",
      };
      if (!socketRef.current?.send("call:accept", { call_id: incoming.call_id })) {
        throw new Error("Соединение с сервисом звонков потеряно. Попробуйте принять вызов ещё раз.");
      }
    } catch (error) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setCallId(null);
      activeCallRef.current = { callId: null, chatId: null, media: "audio" };
      pendingActionRef.current = null;
      setCallError(error.message || "Не удалось получить доступ к микрофону или камере.");
      setMediaPending(false);
    }
  };

  const declineCall = () => {
    if (incomingCall?.call_id) {
      socketRef.current?.send("call:decline", { call_id: incomingCall.call_id });
    }
    releaseMedia();
    closePanelRef.current?.();
  };

  const toggleMicrophone = () => {
    const nextEnabled = muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    setMuted(!nextEnabled);
  };

  const toggleCamera = () => {
    const nextEnabled = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    setCameraEnabled(nextEnabled);
  };

  const changeInvite = async () => {
    if (!callId || inviteBusy) return;
    setInviteBusy(true);
    setCallError("");
    try {
      if (invite) {
        await revokeCallInvite(invite.invite_id);
        setInvite(null);
      } else {
        const created = await createCallInvite(callId);
        if (activeCallRef.current.callId === callId) setInvite(created);
      }
    } catch (error) {
      setCallError(error.message || "Не удалось изменить приглашение.");
    } finally {
      setInviteBusy(false);
    }
  };

  const visible = open || phase !== "idle";
  if (!visible) return null;

  const connectionMessage = {
    connecting: "Подключаемся к сервису звонков…",
    authenticating: "Проверяем доступ…",
    disconnected: "Нет соединения с сервисом звонков.",
    unauthorized: "Не удалось подтвердить вход в сервисе звонков.",
    unconfigured: "Сервис звонков ещё не настроен.",
    error: "Не удалось подключиться к сервису звонков.",
  }[socketStatus];
  const activeChatName = callChatId === chatId ? chatName : "Звонок в чате";

  return (
    <div className="call-backdrop" role="presentation">
      <section className="call-panel" role="dialog" aria-modal="true" aria-label="Звонок">
        <header className="call-panel__header">
          <div>
            <p className="call-panel__eyebrow">SPARK · ЗВОНКИ</p>
            <h2>{phase === "incoming" ? "Входящий звонок" : activeChatName || "Звонок"}</h2>
            <p className="call-panel__status" aria-live="polite">
              {phase === "incoming" && `${callerName} · ${callMedia === "video" ? "видеозвонок" : "аудиозвонок"}`}
              {phase === "outgoing" && "Вызов отправлен · ждём ответа"}
              {phase === "connecting" && "Соединяем участников…"}
              {phase === "connected" && `${formatDuration(elapsedSeconds)} · ${participants.length + 1} участника`}
              {phase === "idle" && (connectionMessage || "Выберите тип звонка")}
            </p>
          </div>
          {phase === "idle" && (
            <button className="call-panel__close" type="button" onClick={onClose} aria-label="Закрыть звонки">×</button>
          )}
        </header>

        {phase === "idle" && !guestToken && (
          <div className="call-panel__start">
            <div className="call-panel__symbol" aria-hidden="true">✦</div>
            <p>Начните звонок с участниками этого чата.</p>
            {socketStatus !== "ready" && <p className="call-panel__hint">{connectionMessage}</p>}
            {socketStatus === "unconfigured" && (
              <p className="call-panel__hint">Сервис звонков недоступен в этом окружении.</p>
            )}
            <div className="call-panel__start-actions">
              <button type="button" disabled={socketStatus !== "ready" || !chatId || mediaPending} onClick={() => startCall("audio")}>
                <span aria-hidden="true">☎</span> Аудиозвонок
              </button>
              <button type="button" disabled={socketStatus !== "ready" || !chatId || mediaPending} onClick={() => startCall("video")}>
                <span aria-hidden="true">▣</span> Видеозвонок
              </button>
            </div>
          </div>
        )}

        {phase === "incoming" && (
          <div className="call-panel__incoming">
            <div className="call-panel__caller" aria-hidden="true">{callerName.slice(0, 1).toUpperCase()}</div>
            <strong>{callerName}</strong>
            <span>{callMedia === "video" ? "Видеозвонок" : "Аудиозвонок"}</span>
            <div className="call-panel__incoming-actions">
              <button type="button" className="call-control call-control--danger" onClick={declineCall} disabled={mediaPending} aria-label="Отклонить звонок">✕</button>
              <button type="button" className="call-control call-control--accept" onClick={acceptCall} disabled={mediaPending} aria-label="Принять звонок">☎</button>
            </div>
          </div>
        )}

        {(phase === "outgoing" || phase === "connecting" || phase === "connected") && (
          <>
            <div className={`call-panel__stage ${callMedia === "video" ? "call-panel__stage--video" : ""}`}>
              {Object.entries(remoteStreams).length ? (
                Object.entries(remoteStreams).map(([peerId, stream]) => {
                  const participant = participants.find((item) => item.peer_id === peerId);
                  return <MediaTile key={peerId} stream={stream} label={participant?.display_name || "Участник"} />;
                })
              ) : (
                <div className="call-panel__waiting">
                  <div className="call-panel__caller" aria-hidden="true">{callerName.slice(0, 1).toUpperCase()}</div>
                  <strong>{callerName || "Участники чата"}</strong>
                  <span>{phase === "outgoing" ? "Ожидание ответа" : "Ожидание подключения"}</span>
                </div>
              )}
              {localStream && <MediaTile stream={localStream} label="Вы" local />}
            </div>
            <div className="call-panel__controls">
              <button type="button" className={muted ? "call-control call-control--off" : "call-control"} onClick={toggleMicrophone} aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}>
                {muted ? "♩̸" : "♩"}
              </button>
              {callMedia === "video" && (
                <button type="button" className={!cameraEnabled ? "call-control call-control--off" : "call-control"} onClick={toggleCamera} aria-label={cameraEnabled ? "Выключить камеру" : "Включить камеру"}>
                  ▣
                </button>
              )}
              <button type="button" className="call-control call-control--danger" disabled={mediaPending} onClick={() => {
                endCall(true);
                if (guestToken) onClose?.();
              }} aria-label="Завершить звонок">☎</button>
            </div>
            {canInvite && callId && callChatId === chatId && (
              <div className="call-panel__invite">
                {invite && <input aria-label="Гостевая ссылка" readOnly value={invite.invite_url} onFocus={(event) => event.target.select()} />}
                <button type="button" disabled={inviteBusy} onClick={changeInvite}>
                  {invite ? "Отозвать ссылку" : "Создать гостевую ссылку"}
                </button>
              </div>
            )}
          </>
        )}

        {callError && <p className="call-panel__error" role="alert">{callError}</p>}
      </section>
    </div>
  );
}
