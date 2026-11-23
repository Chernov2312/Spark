import { useCallback, useEffect, useRef, useState } from "react";
import { callAudioConstraints } from "../api/calls";

export default function CallLobby({
  media, ready, participantCount, pending, canConfirm, guestName, onGuestNameChange, onConfirm, onCancel, onCheck,
}) {
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const resources = useRef({});
  const video = useRef(null);
  const level = useRef(null);

  const stopPreview = useCallback(() => {
    const current = resources.current;
    resources.current = {};
    current.stream?.getTracks().forEach((track) => track.stop());
    cancelAnimationFrame(current.frame);
    void current.analyserContext?.close().catch(() => {});
    void current.soundContext?.close().catch(() => {});
  }, []);

  useEffect(() => stopPreview, [stopPreview]);

  useEffect(() => {
    if (video.current) video.current.srcObject = preview;
  }, [preview]);

  const checkDevices = async () => {
    stopPreview();
    const current = resources.current;
    setPreview(null);
    setError("");
    setChecking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: callAudioConstraints(), video: media === "video" });
      if (resources.current !== current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      current.stream = stream;
      setPreview(stream);
      if (stream.getAudioTracks().length) {
        const context = new AudioContext();
        current.analyserContext = context;
        void context.resume().catch(() => {});
        const analyser = context.createAnalyser();
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const update = () => {
          analyser.getByteTimeDomainData(samples);
          const amplitude = samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample - 128)), 0);
          if (level.current) level.current.value = amplitude;
          current.frame = requestAnimationFrame(update);
        };
        update();
      }
    } catch {
      if (resources.current === current) setError("Не удалось проверить микрофон или камеру. Проверьте разрешения браузера.");
    } finally {
      if (resources.current === current) setChecking(false);
    }
  };

  const checkSound = () => {
    const current = resources.current;
    setError("");
    void current.soundContext?.close().catch(() => {});
    try {
      const context = new AudioContext();
      current.soundContext = context;
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.frequency.value = 440;
      volume.gain.value = 0.08;
      tone.connect(volume).connect(context.destination);
      tone.onended = () => {
        if (current.soundContext === context) current.soundContext = null;
        void context.close().catch(() => {});
      };
      tone.start();
      tone.stop(context.currentTime + 0.4);
    } catch {
      setError("Не удалось воспроизвести пробный звук.");
    }
  };

  return (
    <form className="call-lobby" aria-label="Проверка перед звонком" onSubmit={(event) => {
      event.preventDefault();
      stopPreview();
      setPreview(null);
      onConfirm();
    }}>
      <p role="status">
        {ready === null ? "Проверяем медиасервер…" : ready ? "Медиасервер доступен" : "Медиасервер недоступен"}
        {participantCount > 0 && <span> · Уже в звонке: {participantCount}</span>}
      </p>
      {preview && media === "video" && <video ref={video} muted autoPlay playsInline aria-label="Предпросмотр камеры" />}
      {preview?.getAudioTracks().length > 0 && (
        <label className="call-lobby__meter">
          Уровень микрофона
          <meter ref={level} min={0} max={128} value={0} />
        </label>
      )}
      {onGuestNameChange && (
        <label className="call-panel__guest-name">
          Ник в звонке
          <input type="text" value={guestName} onChange={(event) => onGuestNameChange(event.target.value)}
            autoComplete="nickname" placeholder="Необязательно" disabled={pending} />
        </label>
      )}
      <div className="call-panel__start-actions">
        <button type="button" disabled={checking || pending} onClick={checkDevices}>
          {media === "video" ? "Проверить камеру и микрофон" : "Проверить микрофон"}
        </button>
        <button type="button" disabled={pending} onClick={checkSound}>Проверить звук</button>
        {ready === false && <button type="button" disabled={pending} onClick={onCheck}>Проверить связь</button>}
      </div>
      {error && <p className="call-panel__error" role="alert">{error}</p>}
      <div className="call-panel__start-actions">
        <button type="button" disabled={pending} onClick={onCancel}>Отмена</button>
        <button type="submit" disabled={!canConfirm || checking || pending}>Подключиться</button>
      </div>
    </form>
  );
}
