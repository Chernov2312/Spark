import { useCallback, useEffect, useRef, useState } from "react";

import { createCallInvite, createCallSocket, revokeCallInvite } from "../api/calls";

const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];
// Both peers use this order for the video transceivers in the SDP offer.
const VIDEO_SOURCES = ["camera", "screen"];
const GUEST_NAME_MAX_LENGTH = 50;

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function stopLocalTracks(localTracksRef) {
  Object.values(localTracksRef.current).forEach((track) => track?.stop());
  localTracksRef.current = {};
}

function stopCallResources(peers, localTracksRef) {
  for (const { connection } of peers.values()) connection.close();
  peers.clear();
  stopLocalTracks(localTracksRef);
}

function getVideoTransceivers(connection) {
  return connection.getTransceivers().filter(({ receiver }) => receiver.track.kind === "video");
}

function CallMedia({ track, audio = false }) {
  const mediaRef = useRef(null);

  useEffect(() => {
    const mediaElement = mediaRef.current;
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

function MediaTile({ track, label, variant }) {
  const className = variant ? `call-tile call-tile--${variant}` : "call-tile";
  return (
    <div className={className} role="group" aria-label={label}>
      {track ? (
        <CallMedia track={track} />
      ) : (
        <div className="call-tile__avatar" aria-hidden="true">{Array.from(label)[0]?.toUpperCase()}</div>
      )}
      <span className="call-tile__name">{label}</span>
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
  const [guestName, setGuestName] = useState("");
  const [participants, setParticipants] = useState([]);
  const [remoteMedia, setRemoteMedia] = useState({});
  const [localTracks, setLocalTracks] = useState({});
  const [muted, setMuted] = useState(false);
  const [videoPending, setVideoPending] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [callError, setCallError] = useState("");
  const [mediaPending, setMediaPending] = useState(false);
  const [invite, setInvite] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  const socketRef = useRef(null);
  const localTracksRef = useRef({});
  const peersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const activeCallRef = useRef({ callId: null, chatId: null, media: "audio" });
  const incomingCallRef = useRef(null);
  const pendingActionRef = useRef(null);
  const closePanelRef = useRef(onClose);

  useEffect(() => {
    closePanelRef.current = onClose;
  }, [onClose]);

  const releaseMedia = useCallback(() => {
    pendingActionRef.current = null;
    stopCallResources(peersRef.current, localTracksRef);
    pendingCandidatesRef.current.clear();
    setLocalTracks({});
    setRemoteMedia({});
    setParticipants([]);
    setCallId(null);
    setCallChatId(null);
    setIncomingCall(null);
    setElapsedSeconds(0);
    setMuted(false);
    setMediaPending(false);
    setVideoPending(false);
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

  const resetAccept = useCallback(() => {
    stopLocalTracks(localTracksRef);
    setLocalTracks({});
    setCallId(null);
    activeCallRef.current = { callId: null, chatId: null, media: "audio" };
    pendingActionRef.current = null;
    setMediaPending(false);
  }, []);

  const addRemoteParticipant = useCallback((participant) => {
    if (!participant?.peer_id) return;
    setParticipants((current) => [
      ...current.filter((item) => item.peer_id !== participant.peer_id),
      participant,
    ]);
  }, []);

  const updateRemoteMedia = useCallback((peerId, media) => {
    setRemoteMedia((current) => ({ ...current, [peerId]: { ...current[peerId], ...media } }));
  }, []);

  const createPeer = useCallback((peerId, { offerer = false, videoSlots = false } = {}) => {
    const connection = new RTCPeerConnection({
      iceServers: iceServersRef.current,
    });
    const peer = { connection, videoSlots, videoSenders: {} };
    const { audio, camera } = localTracksRef.current;
    const stream = new MediaStream([audio, !videoSlots && camera].filter(Boolean));
    if (audio) connection.addTrack(audio, stream);
    if (!videoSlots && camera) peer.videoSenders.camera = connection.addTrack(camera, stream);
    if (videoSlots && offerer) {
      for (const source of VIDEO_SOURCES) {
        peer.videoSenders[source] = connection.addTransceiver("video", { direction: "sendrecv" }).sender;
      }
    }
    connection.onicecandidate = ({ candidate }) => {
      const active = activeCallRef.current;
      if (candidate?.candidate && active.callId && peersRef.current.get(peerId) === peer) {
        socketRef.current?.send("rtc:ice", {
          call_id: active.callId,
          target_id: peerId,
          candidate,
        });
      }
    };
    connection.ontrack = ({ track, transceiver }) => {
      if (peersRef.current.get(peerId) !== peer) return;
      if (track.kind === "audio") {
        updateRemoteMedia(peerId, { audio: track });
        return;
      }
      const source = VIDEO_SOURCES[getVideoTransceivers(connection).indexOf(transceiver)];
      if (source) updateRemoteMedia(peerId, videoSlots ? { [source]: track } : { camera: track, cameraOn: true });
    };
    connection.onconnectionstatechange = () => {
      if (peersRef.current.get(peerId) !== peer) return;
      if (connection.connectionState === "connected") {
        setPhase("connected");
      }
      if (connection.connectionState === "failed") {
        setCallError("Не удалось установить соединение. Проверьте сеть и TURN-сервер.");
      }
    };
    peersRef.current.set(peerId, peer);
    return peer;
  }, [updateRemoteMedia]);

  const publishVideo = useCallback((peerId, peer) => {
    if (!peer.videoSlots || !peer.connection.localDescription || peersRef.current.get(peerId) !== peer) return;
    socketRef.current?.send("rtc:video", {
      call_id: activeCallRef.current.callId,
      target_id: peerId,
      video: {
        camera: peer.videoSenders.camera?.track?.readyState === "live",
        screen: peer.videoSenders.screen?.track?.readyState === "live",
      },
    });
  }, []);

  const syncPeerVideo = useCallback(async (peerId, peer, tracks) => {
    const results = await Promise.allSettled(Object.entries(peer.videoSenders).map(
      ([source, sender]) => sender.replaceTrack(tracks[source] ?? null),
    ));
    if (peersRef.current.get(peerId) !== peer) return;
    if (results.some(({ status }) => status === "rejected")) {
      setCallError("Не удалось передать видео участнику звонка.");
    }
    publishVideo(peerId, peer);
  }, [publishVideo]);

  const setVideoTrack = useCallback((source, track) => {
    const tracks = localTracksRef.current;
    tracks[source]?.stop();
    tracks[source] = track;
    setLocalTracks({ ...tracks });
    for (const [peerId, peer] of peersRef.current) void syncPeerVideo(peerId, peer, tracks);
  }, [syncPeerVideo]);

  const watchVideoEnd = useCallback((source, track) => {
    track?.addEventListener("ended", () => {
      if (localTracksRef.current[source] === track) setVideoTrack(source, null);
    }, { once: true });
  }, [setVideoTrack]);

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
      if (pendingActionRef.current === "accept" && data.code === "invalid_guest_name") resetAccept();
      else if (pendingActionRef.current) releaseMedia();
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
      const peer = peersRef.current.get(data.peer_id) || createPeer(data.peer_id, {
        offerer: data.should_offer,
        videoSlots: data.video_slots === true,
      });
      if (data.should_offer) {
        const { connection } = peer;
        await syncPeerVideo(data.peer_id, peer, localTracksRef.current);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        if (peersRef.current.get(data.peer_id) !== peer) return;
        socketRef.current?.send("rtc:offer", {
          call_id: activeId,
          target_id: data.peer_id,
          sdp: connection.localDescription,
        });
        publishVideo(data.peer_id, peer);
      }
      return;
    }
    if (event === "rtc:offer") {
      const peer = peersRef.current.get(data.from_id) || createPeer(data.from_id);
      const { connection } = peer;
      await connection.setRemoteDescription(data.sdp);
      await applyPendingCandidates(data.from_id, connection);
      if (peer.videoSlots) {
        const video = getVideoTransceivers(connection);
        VIDEO_SOURCES.forEach((source, index) => {
          const transceiver = video[index];
          if (!transceiver) return;
          transceiver.direction = "sendrecv";
          peer.videoSenders[source] = transceiver.sender;
        });
        await syncPeerVideo(data.from_id, peer, localTracksRef.current);
      }
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      if (peersRef.current.get(data.from_id) !== peer) return;
      socketRef.current?.send("rtc:answer", {
        call_id: activeId,
        target_id: data.from_id,
        sdp: connection.localDescription,
      });
      publishVideo(data.from_id, peer);
      return;
    }
    if (event === "rtc:answer") {
      const connection = peersRef.current.get(data.from_id)?.connection;
      if (connection) {
        await connection.setRemoteDescription(data.sdp);
        await applyPendingCandidates(data.from_id, connection);
      }
      return;
    }
    if (event === "rtc:video") {
      if (peersRef.current.get(data.from_id)?.videoSlots && data.video) {
        updateRemoteMedia(data.from_id, { cameraOn: data.video.camera, screenOn: data.video.screen });
      }
      return;
    }
    if (event === "rtc:ice") {
      const connection = peersRef.current.get(data.from_id)?.connection;
      if (!connection || !connection.remoteDescription) {
        const pending = pendingCandidatesRef.current.get(data.from_id) || [];
        pendingCandidatesRef.current.set(data.from_id, [...pending, data.candidate]);
      } else {
        await connection.addIceCandidate(data.candidate);
      }
      return;
    }
    if (event === "call:peer_left") {
      peersRef.current.get(data.peer_id)?.connection.close();
      peersRef.current.delete(data.peer_id);
      pendingCandidatesRef.current.delete(data.peer_id);
      setRemoteMedia((current) => {
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
  }, [addRemoteParticipant, applyPendingCandidates, createPeer, endCall, guestToken, publishVideo, releaseMedia, resetAccept, syncPeerVideo, updateRemoteMedia]);

  useEffect(() => {
    const peers = peersRef.current;
    const pendingCandidates = pendingCandidatesRef.current;
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
      socket.close();
      stopCallResources(peers, localTracksRef);
      pendingCandidates.clear();
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
    const tracks = localTracksRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
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
    if (socketStatus !== "ready" || !chatId || mediaPending) return;
    setCallError("");
    setMediaPending(true);
    pendingActionRef.current = "start";
    const tracks = localTracksRef.current;
    try {
      if (!await acquireMedia(media)) return;
      setCallChatId(chatId);
      setCallerName(chatName || "Звонок в чате");
      setPhase("outgoing");
      if (!await socketRef.current?.sendAuthorized("call:start", { chat_id: chatId, media })) {
        throw new Error("Сервис звонков недоступен. Попробуйте подключиться снова.");
      }
    } catch (error) {
      if (tracks !== localTracksRef.current) return;
      releaseMedia();
      setCallError(error.message || "Не удалось получить доступ к микрофону или камере.");
    }
  };

  const acceptCall = async () => {
    const incoming = incomingCallRef.current;
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
      setCallChatId(incoming.chat_id);
      setCallerName(incoming.caller_name || "Участник чата");
      activeCallRef.current = {
        callId: incoming.call_id,
        chatId: incoming.chat_id,
        media: incoming.media || "audio",
      };
      if (!await socketRef.current?.sendAuthorized("call:accept", {
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

  const toggleMicrophone = () => {
    const { audio } = localTracksRef.current;
    if (audio) audio.enabled = muted;
    setMuted(!muted);
  };

  const toggleVideo = async (source) => {
    const tracks = localTracksRef.current;
    if (tracks[source]) {
      setVideoTrack(source, null);
      return;
    }
    const isScreen = source === "screen";
    const devices = navigator.mediaDevices;
    const capture = isScreen ? devices?.getDisplayMedia : devices?.getUserMedia;
    if (!capture) {
      setCallError(isScreen ? "Браузер не поддерживает показ экрана." : "Браузер не поддерживает доступ к камере.");
      return;
    }
    setVideoPending(true);
    setCallError("");
    try {
      const stream = await capture.call(devices, { video: true, audio: false });
      const [track] = stream.getVideoTracks();
      if (tracks !== localTracksRef.current || !track || track.readyState === "ended") {
        stream.getTracks().forEach((item) => item.stop());
        if (tracks !== localTracksRef.current) return;
        throw new Error("Video track unavailable");
      }
      if (isScreen) track.contentHint = "detail";
      watchVideoEnd(source, track);
      setVideoTrack(source, track);
    } catch (error) {
      if (tracks === localTracksRef.current && (error.name !== "NotAllowedError" || !isScreen)) {
        setCallError(isScreen ? "Не удалось начать показ экрана." : "Не удалось включить камеру.");
      }
    } finally {
      if (tracks === localTracksRef.current) setVideoPending(false);
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
  const mediaParticipants = participants.filter(({ peer_id }) => remoteMedia[peer_id]);
  const cameraAction = localTracks.camera ? "Выключить камеру" : "Включить камеру";
  const screenAction = localTracks.screen ? "Остановить показ экрана" : "Показать экран";

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
          <form className="call-panel__incoming" onSubmit={(event) => {
            event.preventDefault();
            void acceptCall();
          }}>
            <div className="call-panel__caller" aria-hidden="true">{callerName.slice(0, 1).toUpperCase()}</div>
            <strong>{callerName}</strong>
            <span>{callMedia === "video" ? "Видеозвонок" : "Аудиозвонок"}</span>
            {guestToken && (
              <label className="call-panel__guest-name">
                Ник в звонке
                <input type="text" value={guestName} onChange={(event) => setGuestName(event.target.value)}
                  autoComplete="nickname" placeholder="Необязательно" disabled={mediaPending} />
              </label>
            )}
            <div className="call-panel__incoming-actions">
              <button type="button" className="call-control call-control--danger" onClick={declineCall} disabled={mediaPending} aria-label="Отклонить звонок">✕</button>
              <button type="submit" className="call-control call-control--accept" disabled={mediaPending} aria-label="Принять звонок">☎</button>
            </div>
          </form>
        )}

        {(phase === "outgoing" || phase === "connecting" || phase === "connected") && (
          <>
            <div className={`call-panel__stage ${callMedia === "video" ? "call-panel__stage--video" : ""}`}>
              {mediaParticipants.map(({ peer_id, display_name }) => {
                const { screen, screenOn } = remoteMedia[peer_id];
                return screen && screenOn && (
                  <MediaTile key={peer_id} track={screen} label={`${display_name || "Участник"} · экран`} variant="screen" />
                );
              })}
              {localTracks.screen && <MediaTile track={localTracks.screen} label="Ваш экран" variant="screen" />}
              {mediaParticipants.length ? (
                mediaParticipants.map(({ peer_id, display_name }) => {
                  const { audio, camera, cameraOn } = remoteMedia[peer_id];
                  return (
                    <div className="call-participant" key={peer_id}>
                      {audio && <CallMedia track={audio} audio />}
                      <MediaTile track={cameraOn ? camera : null} label={display_name || "Участник"} />
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
              {(localTracks.audio || localTracks.camera) && <MediaTile track={localTracks.camera} label="Вы" variant="local" />}
            </div>
            <div className="call-panel__controls">
              <button type="button" className={muted ? "call-control call-control--off" : "call-control"} onClick={toggleMicrophone} aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}>
                {muted ? "♩̸" : "♩"}
              </button>
              <button type="button" className="call-control call-control--text" disabled={mediaPending || videoPending}
                onClick={() => toggleVideo("camera")} aria-label={cameraAction} title={cameraAction} aria-pressed={Boolean(localTracks.camera)}>
                Камера
              </button>
              <button type="button" className="call-control call-control--text" disabled={mediaPending || videoPending}
                onClick={() => toggleVideo("screen")} aria-label={screenAction} aria-pressed={Boolean(localTracks.screen)}>
                {localTracks.screen ? "Остановить показ" : "Показать экран"}
              </button>
              <button type="button" className="call-control call-control--danger" disabled={mediaPending} onClick={() => {
                endCall(true);
                if (guestToken) onClose?.();
              }} aria-label="Завершить звонок">☎</button>
            </div>
            {canInvite && callId && callChatId === chatId && (
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
