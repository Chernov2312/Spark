import { useCallback, useEffect, useRef, useState } from "react";

import { callAudioConstraints, callMediaUrl, createCallInvite, createCallSocket, revokeCallInvite } from "../api/calls";
import CallLobby from "./CallLobby";

const TRACK_SOURCES = { audio: "microphone", camera: "camera", screen: "screen_share" };
const GUEST_NAME_MAX_LENGTH = 50;
const CONNECTION_LABELS = {
  new: "Подключение…",
  connecting: "Подключение…",
  disconnected: "Связь прервана",
};

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function stopLocalTracks(localTracksRef) {
  Object.values(localTracksRef.current).forEach((track) => track?.stop());
  localTracksRef.current = {};
}

function disconnectRoom(roomRef) {
  const room = roomRef.current;
  roomRef.current = null;
  if (room) {
    room.removeAllListeners();
    void room.disconnect(false).catch(() => {});
  }
}

function CallMedia({ track, audio = false }) {
  const mediaRef = useRef(null);

  useEffect(() => {
    const mediaElement = mediaRef.current;
    if (track.attach) {
      track.attach(mediaElement);
      return () => track.detach(mediaElement);
    }
    mediaElement.srcObject = new MediaStream([track]);
    const playback = mediaElement.play?.();
    playback?.catch(() => {});
    return () => {
      mediaElement.srcObject = null;
    };
  }, [track]);

  return audio
    ? <audio ref={mediaRef} autoPlay hidden />
    : <video ref={mediaRef} autoPlay playsInline muted />;
}

function MicrophoneIcon({ muted }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1m-7 8v3m-3 0h6" />
      {muted && <path d="M3 3l18 18" />}
    </svg>
  );
}

function MediaTile({ track, label, variant, muted, connectionState }) {
  const className = variant ? `call-tile call-tile--${variant}` : "call-tile";
  const microphoneLabel = muted ? "Микрофон выключен" : "Микрофон включён";
  const connectionLabel = CONNECTION_LABELS[connectionState];
  return (
    <div className={className} role="group" aria-label={label}>
      {track ? (
        <CallMedia track={track} />
      ) : (
        <div className="call-tile__avatar" aria-hidden="true">{Array.from(label)[0]?.toUpperCase()}</div>
      )}
      {(typeof muted === "boolean" || connectionLabel) && (
        <div className="call-tile__indicators">
          {connectionLabel && (
            <span className="call-tile__indicator call-tile__indicator--connection" data-state={connectionState}
              role="img" aria-label={connectionLabel} title={connectionLabel}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 20v-3m5 3v-7" />
                {connectionState === "disconnected"
                  ? <path d="m14 9 6 6m0-6-6 6" />
                  : <path d="M14 20V9m5 11V5" />}
              </svg>
            </span>
          )}
          {typeof muted === "boolean" && (
            <span className={muted ? "call-tile__indicator call-tile__indicator--muted" : "call-tile__indicator"}
              role="img" aria-label={microphoneLabel} title={microphoneLabel}>
              <MicrophoneIcon muted={muted} />
            </span>
          )}
        </div>
      )}
      <span className="call-tile__name">{label}</span>
    </div>
  );
}

export default function CallPanel({
  chatId, chatName, open, onClose, canInvite, guestToken, standalone, joinRequest, onChatCallChange,
}) {
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [callPhase, setPhase] = useState("idle");
  const [incomingCall, setIncomingCall] = useState(null);
  const [callId, setCallId] = useState(null);
  const [callChatId, setCallChatId] = useState(null);
  const [callMedia, setCallMedia] = useState("audio");
  const [callerName, setCallerName] = useState("");
  const [guestName, setGuestName] = useState("");
  const [participants, setParticipants] = useState([]);
  const [remoteMedia, setRemoteMedia] = useState({});
  const [localTracks, setLocalTracks] = useState({});
  const [muted, setMuted] = useState(false);
  const [mediaStatus, setMediaStatus] = useState("idle");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const [videoPending, setVideoPending] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [callError, setCallError] = useState("");
  const [mediaPending, setMediaPending] = useState(false);
  const [invite, setInvite] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [lobbyReady, setLobbyReady] = useState(null);

  const socketRef = useRef(null);
  const localTracksRef = useRef({});
  const roomRef = useRef(null);
  const activeCallRef = useRef({ callId: null, chatId: null, media: "audio" });
  const incomingCallRef = useRef(null);
  const pendingActionRef = useRef(null);
  const closePanelRef = useRef(onClose);
  const observedChat = useRef(chatId);

  useEffect(() => {
    closePanelRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    observedChat.current = chatId;
  }, [chatId]);

  const releaseMedia = useCallback(() => {
    pendingActionRef.current = null;
    disconnectRoom(roomRef);
    stopLocalTracks(localTracksRef);
    setLocalTracks({});
    setRemoteMedia({});
    setParticipants([]);
    setCallId(null);
    setCallChatId(null);
    setIncomingCall(null);
    setElapsedSeconds(0);
    setMuted(false);
    setMediaStatus("idle");
    setAudioBlocked(false);
    setMicPending(false);
    setMediaPending(false);
    setVideoPending(false);
    setInvite(null);
    setLobbyReady(null);
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

  const resetAccept = useCallback(() => {
    stopLocalTracks(localTracksRef);
    setLocalTracks({});
    setCallId(null);
    activeCallRef.current = { callId: null, chatId: null, media: "audio" };
    pendingActionRef.current = null;
    setMediaPending(false);
  }, []);

  const joinMedia = useCallback(async (token) => {
    const activeCall = activeCallRef.current;
    const failed = () => {
      if (activeCallRef.current !== activeCall) return;
      endCall();
      setCallError("Не удалось подключиться к LiveKit. Проверьте соединение.");
    };
    setMediaStatus("connecting");
    try {
      const { ConnectionQuality, Room, RoomEvent } = await import("livekit-client");
      if (activeCallRef.current !== activeCall) return;

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      const syncTracks = () => {
        if (roomRef.current !== room) return;
        const microphone = room.localParticipant.getTrackPublication(TRACK_SOURCES.audio);
        if (microphone) setMuted(microphone.isMuted);
        const subscribed = Object.fromEntries(Array.from(room.remoteParticipants.values(), (participant) => {
          const audio = participant.getTrackPublication(TRACK_SOURCES.audio);
          const camera = participant.getTrackPublication(TRACK_SOURCES.camera);
          const screen = participant.getTrackPublication(TRACK_SOURCES.screen);
          return [participant.identity, {
            audio: audio?.track,
            camera: camera?.isMuted ? null : camera?.track,
            screen: screen?.isMuted ? null : screen?.track,
            muted: !audio || audio.isMuted,
            connectionState: participant.connectionQuality === ConnectionQuality.Lost ? "disconnected" : "connected",
          }];
        }));
        setRemoteMedia((current) => {
          const next = { ...subscribed };
          for (const [peerId, previous] of Object.entries(current)) {
            if (!(peerId in subscribed)) {
              next[peerId] = { muted: previous.muted, connectionState: "disconnected" };
            }
          }
          return next;
        });
      };

      for (const event of [
        RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
        RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.ConnectionQualityChanged,
      ]) {
        room.on(event, syncTracks);
      }
      room
        .on(RoomEvent.Reconnecting, () => setMediaStatus("reconnecting"))
        .on(RoomEvent.Reconnected, () => {
          setMediaStatus("connected");
          syncTracks();
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
        .on(RoomEvent.Disconnected, failed);

      await room.connect(callMediaUrl(), token);
      if (roomRef.current !== room) return;
      await Promise.all(Object.entries(localTracksRef.current).filter(([, track]) => track?.readyState === "live")
        .map(([source, track]) => room.localParticipant.publishTrack(track, { source: TRACK_SOURCES[source] })));
      if (roomRef.current !== room) return;
      setMediaStatus("connected");
      syncTracks();
    } catch {
      failed();
    }
  }, [endCall]);

  const stopVideo = useCallback(async (source) => {
    const tracks = localTracksRef.current;
    const track = tracks[source];
    if (!track) return;
    track.stop();
    tracks[source] = null;
    setLocalTracks({ ...tracks });
    const room = roomRef.current;
    try {
      await room?.localParticipant.unpublishTrack(track);
    } catch {
      if (roomRef.current === room) setCallError("Не удалось остановить передачу видео.");
    }
  }, []);

  const watchVideoEnd = useCallback((source, track) => {
    track?.addEventListener("ended", () => {
      if (localTracksRef.current[source] === track) void stopVideo(source);
    }, { once: true });
  }, [stopVideo]);

  const handleSocketEvent = useCallback((event, data) => {
    if (event === "auth:ok") {
      setSocketStatus("ready");
      if (!activeCallRef.current.callId && !incomingCallRef.current) setCallError("");
      return;
    }
    if (event === "auth:error") {
      setSocketStatus("unauthorized");
      setCallError(data.message || "Не удалось подключиться к сервису звонков.");
      return;
    }
    if (event === "call:status") {
      if (observedChat.current === data.chat_id) onChatCallChange?.(data);
      return;
    }
    if (event === "call:checked") {
      setLobbyReady(data.media_ready === true);
      return;
    }
    if (event === "call:incoming") {
      if (activeCallRef.current.callId || pendingActionRef.current) return;
      setIncomingCall(data);
      incomingCallRef.current = data;
      setLobbyReady(null);
      setCallMedia(data.media || "audio");
      setCallChatId(data.chat_id || null);
      setCallerName(data.caller_name || "Участник чата");
      setCallError("");
      setPhase("incoming");
      return;
    }
    if (event === "call:started") {
      pendingActionRef.current = null;
      setMediaPending(false);
      setCallId(data.call_id);
      setCallChatId(data.chat_id || null);
      setCallMedia(data.media || "audio");
      activeCallRef.current = {
        callId: data.call_id,
        chatId: data.chat_id,
        media: data.media || "audio",
      };
      setPhase("outgoing");
      void joinMedia(data.media_token);
      return;
    }
    const activeId = activeCallRef.current.callId || incomingCallRef.current?.call_id;
    if (event === "call:error") {
      if (pendingActionRef.current === "accept" && data.code === "invalid_guest_name") resetAccept();
      else if (pendingActionRef.current) releaseMedia();
      setCallError(data.message || "Не удалось выполнить действие со звонком.");
      return;
    }
    if (!activeId || data.call_id !== activeId) return;
    if (event === "call:accepted") {
      if (data.media_token) {
        pendingActionRef.current = null;
        setMediaPending(false);
        incomingCallRef.current = null;
        setIncomingCall(null);
        void joinMedia(data.media_token);
      }
      setPhase("connecting");
      return;
    }
    if (event === "call:peer_joined") {
      setParticipants((current) => [
        ...current.filter(({ peer_id }) => peer_id !== data.peer_id), data,
      ]);
      return;
    }
    if (event === "call:peer_left") {
      setRemoteMedia((current) => {
        const next = { ...current };
        delete next[data.media_identity || data.peer_id];
        return next;
      });
      setParticipants((current) => current.filter(({ peer_id }) => peer_id !== data.peer_id));
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
    }
  }, [endCall, guestToken, joinMedia, onChatCallChange, releaseMedia, resetAccept]);

  useEffect(() => {
    let closed = false;
    const socket = createCallSocket({
      inviteToken: guestToken,
      onEvent: (event, data) => {
        if (!closed) handleSocketEvent(event, data);
      },
      onStatus: (status) => {
        if (closed) return;
        setSocketStatus(status);
        if (status === "disconnected") {
          releaseMedia();
          onChatCallChange?.(null);
          setCallError("Соединение со звонком потеряно.");
        }
      },
    });
    socketRef.current = socket;
    return () => {
      closed = true;
      socket.close();
      activeCallRef.current = { callId: null, chatId: null, media: "audio" };
      disconnectRoom(roomRef);
      stopLocalTracks(localTracksRef);
    };
  }, [guestToken, handleSocketEvent, onChatCallChange, releaseMedia]);

  useEffect(() => {
    if (socketStatus === "ready" && !guestToken) {
      void socketRef.current?.sendAuthorized("call:watch", { chat_id: chatId || "" }).catch(() => {});
    }
  }, [chatId, guestToken, socketStatus]);

  const joinTarget = incomingCall || (callPhase === "idle" ? joinRequest : null);
  const prejoining = callPhase === "prejoin" || Boolean(joinTarget);
  const checkCall = useCallback(() => {
    if (socketRef.current?.send("call:check", {})) setLobbyReady(null);
  }, []);
  useEffect(() => {
    if (prejoining && socketStatus === "ready") checkCall();
  }, [checkCall, prejoining, socketStatus]);

  let phase = callPhase;
  if (callPhase === "outgoing" || callPhase === "connecting") {
    if (participants.some(({ peer_id, media_identity }) => remoteMedia[media_identity || peer_id])) phase = "connected";
    else if (participants.length) phase = "connecting";
    else if (mediaStatus === "connected") phase = "outgoing";
  }

  useEffect(() => {
    if (phase !== "connected") return undefined;
    const timer = setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const acquireMedia = async (media) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Браузер не поддерживает доступ к микрофону и камере.");
    }
    const tracks = localTracksRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: callAudioConstraints(),
      video: media === "video",
    });
    if (tracks !== localTracksRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    [tracks.audio] = stream.getAudioTracks();
    [tracks.camera] = stream.getVideoTracks();
    watchVideoEnd("camera", tracks.camera);
    setLocalTracks({ ...tracks });
    setCallMedia(media);
    return true;
  };

  const startCall = async (media) => {
    const targetChatId = standalone ? null : chatId;
    if (socketStatus !== "ready" || (!standalone && !targetChatId) || mediaPending) return;
    setCallError("");
    setMediaPending(true);
    pendingActionRef.current = "start";
    const tracks = localTracksRef.current;
    try {
      if (!await acquireMedia(media)) return;
      setCallChatId(targetChatId);
      setCallerName(standalone ? "Звонок по ссылке" : chatName || "Звонок в чате");
      setPhase("outgoing");
      if (!await socketRef.current?.sendAuthorized("call:start", {
        ...(targetChatId && { chat_id: targetChatId }), media,
      })) {
        throw new Error("Сервис звонков недоступен. Попробуйте подключиться снова.");
      }
    } catch (error) {
      if (tracks !== localTracksRef.current) return;
      releaseMedia();
      setCallError(error.message || "Не удалось получить доступ к микрофону или камере.");
    }
  };

  const acceptCall = async () => {
    const ring = incomingCallRef.current;
    const incoming = ring || joinTarget;
    if (!incoming || mediaPending) return;
    const displayName = guestToken ? guestName.trim() : "";
    if ([...displayName].length > GUEST_NAME_MAX_LENGTH || /\p{Cc}/u.test(displayName)) {
      setCallError("Введите ник до 50 символов без управляющих символов.");
      return;
    }
    setCallError("");
    setMediaPending(true);
    pendingActionRef.current = "accept";
    const tracks = localTracksRef.current;
    try {
      if (!await acquireMedia(incoming.media || "audio")) return;
      setCallId(incoming.call_id);
      setCallChatId(incoming.chat_id || null);
      setCallerName(incoming.caller_name || "Участник чата");
      activeCallRef.current = {
        callId: incoming.call_id,
        chatId: incoming.chat_id,
        media: incoming.media || "audio",
      };
      if (!await socketRef.current?.sendAuthorized(ring ? "call:accept" : "call:join", {
        call_id: incoming.call_id,
        ...(displayName && { display_name: displayName }),
      })) {
        throw new Error("Соединение с сервисом звонков потеряно. Попробуйте принять вызов ещё раз.");
      }
    } catch (error) {
      if (tracks !== localTracksRef.current) return;
      resetAccept();
      setCallError(error.message || "Не удалось получить доступ к микрофону или камере.");
    }
  };

  const declineCall = () => {
    if (incomingCall?.call_id) {
      socketRef.current?.send("call:decline", { call_id: incomingCall.call_id });
    }
    releaseMedia();
    closePanelRef.current?.();
  };

  const toggleMicrophone = async () => {
    const room = roomRef.current;
    const publication = room?.localParticipant.getTrackPublication(TRACK_SOURCES.audio);
    if (!publication || micPending) return;
    setMicPending(true);
    try {
      if (publication.isMuted) await publication.unmute();
      else await publication.mute();
      if (roomRef.current === room) setMuted(publication.isMuted);
    } catch {
      if (roomRef.current === room) setCallError("Не удалось изменить состояние микрофона.");
    } finally {
      if (roomRef.current === room) setMicPending(false);
    }
  };

  const toggleVideo = async (source) => {
    const room = roomRef.current;
    if (!room || mediaStatus !== "connected" || videoPending) return;
    const tracks = localTracksRef.current;
    const isScreen = source === "screen";
    const devices = navigator.mediaDevices;
    const capture = isScreen ? devices?.getDisplayMedia : devices?.getUserMedia;
    setVideoPending(true);
    setCallError("");
    let track;
    try {
      if (tracks[source]) {
        await stopVideo(source);
        return;
      }
      if (!capture) throw new Error("Video capture unavailable");
      const stream = await capture.call(devices, { video: true, audio: false });
      [track] = stream.getVideoTracks();
      if (roomRef.current !== room || !track || track.readyState === "ended") {
        stream.getTracks().forEach((item) => item.stop());
        if (roomRef.current !== room) return;
        throw new Error("Video track unavailable");
      }
      if (isScreen) track.contentHint = "detail";
      await room.localParticipant.publishTrack(track, { source: TRACK_SOURCES[source] });
      if (roomRef.current !== room) {
        track.stop();
        return;
      }
      tracks[source] = track;
      if (track.readyState === "ended") {
        await stopVideo(source);
        return;
      }
      watchVideoEnd(source, track);
      setLocalTracks({ ...tracks });
    } catch (error) {
      track?.stop();
      if (roomRef.current === room && (error.name !== "NotAllowedError" || !isScreen)) {
        setCallError(isScreen ? "Не удалось начать показ экрана." : "Не удалось включить камеру.");
      }
    } finally {
      if (roomRef.current === room) setVideoPending(false);
    }
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

  const copyInvite = async (event) => {
    event.currentTarget.select();
    let copyMessage;
    try {
      await navigator.clipboard.writeText(invite.invite_url);
      copyMessage = "Ссылка скопирована";
    } catch {
      copyMessage = "Ссылка выделена для ручного копирования";
    }
    setInvite((current) => current?.invite_id === invite.invite_id ? { ...current, copyMessage } : current);
  };

  const prepareCall = (media) => {
    setLobbyReady(null);
    setCallError("");
    setCallMedia(media);
    setPhase("prejoin");
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
  const standaloneCall = callId && !callChatId && !guestToken;
  const activeChatName = standaloneCall || (standalone && !callId) ? "Звонок по ссылке"
    : callChatId === chatId || !callId ? chatName : "Звонок";
  const reconnecting = mediaStatus === "reconnecting";
  const mediaReady = mediaStatus === "connected";
  const cameraAction = localTracks.camera ? "Выключить камеру" : "Включить камеру";
  const screenAction = localTracks.screen ? "Остановить показ экрана" : "Показать экран";

  return (
    <div className="call-backdrop" role="presentation">
      <section className="call-panel" role="dialog" aria-modal="true" aria-label="Звонок">
        <header className="call-panel__header">
          <div>
            <p className="call-panel__eyebrow">SPARK · ЗВОНКИ</p>
            <h2>{prejoining ? "Перед подключением" : activeChatName || "Звонок"}</h2>
            <p className="call-panel__status" aria-live="polite">
              {prejoining && (joinTarget ? `${joinTarget.caller_name || "Участник чата"} · ` : "")}
              {prejoining && ((joinTarget?.media || callMedia) === "video" ? "Видеозвонок" : "Аудиозвонок")}
              {reconnecting && "Восстанавливаем соединение…"}
              {!reconnecting && phase === "outgoing" && "Вызов отправлен · ждём ответа"}
              {!reconnecting && phase === "connecting" && "Соединяем участников…"}
              {!reconnecting && phase === "connected" && `${formatDuration(elapsedSeconds)} · ${participants.length + 1} участника`}
              {phase === "idle" && !prejoining && (connectionMessage || "Выберите тип звонка")}
            </p>
          </div>
          {phase === "idle" && !prejoining && (
            <button className="call-panel__close" type="button" onClick={onClose} aria-label="Закрыть звонки">×</button>
          )}
        </header>

        {phase === "idle" && !guestToken && !prejoining && (
          <div className="call-panel__start">
            <div className="call-panel__symbol" aria-hidden="true">✦</div>
            <p>{standalone ? "Создайте звонок и пригласите участников по ссылке." : "Начните звонок с участниками этого чата."}</p>
            {socketStatus !== "ready" && <p className="call-panel__hint">{connectionMessage}</p>}
            {socketStatus === "unconfigured" && (
              <p className="call-panel__hint">Сервис звонков недоступен в этом окружении.</p>
            )}
            <div className="call-panel__start-actions">
              <button type="button" disabled={socketStatus !== "ready" || (!chatId && !standalone) || mediaPending} onClick={() => prepareCall("audio")}>
                <span aria-hidden="true">☎</span> Аудиозвонок
              </button>
              <button type="button" disabled={socketStatus !== "ready" || (!chatId && !standalone) || mediaPending} onClick={() => prepareCall("video")}>
                <span aria-hidden="true">▣</span> Видеозвонок
              </button>
            </div>
          </div>
        )}

        {prejoining && (
          <CallLobby key={joinTarget?.call_id || callMedia} media={joinTarget?.media || callMedia}
            ready={lobbyReady} participantCount={joinTarget?.participant_count} pending={mediaPending}
            canConfirm={socketStatus === "ready"} guestName={guestName} onGuestNameChange={guestToken ? setGuestName : null}
            onConfirm={() => { if (joinTarget) void acceptCall(); else void startCall(callMedia); }}
            onCancel={declineCall} onCheck={checkCall} />
        )}

        {(phase === "outgoing" || phase === "connecting" || phase === "connected") && (
          <>
            <div className={`call-panel__stage ${callMedia === "video" ? "call-panel__stage--video" : ""}`}>
              {participants.map(({ peer_id, media_identity, display_name }) => {
                const { screen } = remoteMedia[media_identity || peer_id] || {};
                return screen && (
                  <MediaTile key={peer_id} track={screen} label={`${display_name || "Участник"} · экран`} variant="screen" />
                );
              })}
              {localTracks.screen && <MediaTile track={localTracks.screen} label="Ваш экран" variant="screen" />}
              {participants.length ? (
                participants.map(({ peer_id, media_identity, display_name }) => {
                  const { audio, camera, muted: peerMuted, connectionState = "new" } = remoteMedia[media_identity || peer_id] || {};
                  return (
                    <div className="call-participant" key={peer_id}>
                      {audio && <CallMedia track={audio} audio />}
                      <MediaTile track={camera} label={display_name || "Участник"}
                        muted={peerMuted} connectionState={connectionState} />
                    </div>
                  );
                })
              ) : (
                <div className="call-panel__waiting">
                  <div className="call-panel__caller" aria-hidden="true">{callerName.slice(0, 1).toUpperCase()}</div>
                  <strong>{callerName || "Участники чата"}</strong>
                  <span>{phase === "outgoing" ? "Ожидание ответа" : "Ожидание подключения"}</span>
                </div>
              )}
              {(localTracks.audio || localTracks.camera) && <MediaTile track={localTracks.camera} label="Вы" variant="local" muted={muted} />}
            </div>
            <div className="call-panel__controls">
              <button type="button" className={muted ? "call-control call-control--off" : "call-control"} onClick={toggleMicrophone}
                disabled={!localTracks.audio || !mediaReady || micPending} aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}
                title={muted ? "Включить микрофон" : "Выключить микрофон"}>
                <MicrophoneIcon muted={muted} />
              </button>
              <button type="button" className="call-control call-control--text" disabled={!mediaReady || videoPending}
                onClick={() => toggleVideo("camera")} aria-label={cameraAction} title={cameraAction} aria-pressed={Boolean(localTracks.camera)}>
                Камера
              </button>
              <button type="button" className="call-control call-control--text" disabled={!mediaReady || videoPending}
                onClick={() => toggleVideo("screen")} aria-label={screenAction} aria-pressed={Boolean(localTracks.screen)}>
                {localTracks.screen ? "Остановить показ" : "Показать экран"}
              </button>
              <button type="button" className="call-control call-control--danger" disabled={mediaPending} onClick={() => {
                endCall(true);
                if (guestToken) onClose?.();
              }} aria-label="Завершить звонок">☎</button>
            </div>
            {audioBlocked && (
              <button type="button" className="call-control call-control--text" onClick={() => {
                void roomRef.current?.startAudio().catch(() => {});
              }}>Включить звук</button>
            )}
            {callId && (standaloneCall || (canInvite && callChatId === chatId)) && (
              <div className="call-panel__invite">
                {invite && (
                  <input
                    aria-label="Гостевая ссылка"
                    title="Скопировать гостевую ссылку"
                    readOnly
                    value={invite.invite_url}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={copyInvite}
                    onKeyDown={(event) => { if (event.key === "Enter") void copyInvite(event); }}
                  />
                )}
                <button type="button" disabled={inviteBusy} onClick={changeInvite}>
                  {invite ? "Отозвать ссылку" : "Создать гостевую ссылку"}
                </button>
                {invite && <span className="call-panel__invite-status" role="status">{invite.copyMessage}</span>}
              </div>
            )}
          </>
        )}

        {callError && <p className="call-panel__error" role="alert">{callError}</p>}
      </section>
    </div>
  );
}
