import asyncio
from functools import lru_cache
import os
from pathlib import Path
import tempfile
from typing import Protocol

from pydub import AudioSegment, effects
import whisper


class TranscriptionModel(Protocol):
    def transcribe(self, path: str) -> dict[str, str]: ...


class AudioConverter:
    @staticmethod
    @lru_cache(maxsize=1)
    def _load_model() -> TranscriptionModel:
        return whisper.load_model("base")

    @staticmethod
    def _normalize_file(path: str) -> str | None:
        if not os.path.exists(path):
            return None
        audio = AudioSegment.from_file(path)
        audio = audio.set_channels(1).set_frame_rate(16000)
        normalized = effects.normalize(audio)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as output_file:
            out = output_file.name
        normalized.export(out, format="wav")
        return out

    @classmethod
    def _transcribe_file(cls, path: str) -> str | None:
        res_path = cls._normalize_file(path)
        if res_path is None:
            return None
        try:
            return cls._load_model().transcribe(res_path)["text"]
        finally:
            Path(res_path).unlink(missing_ok=True)

    @classmethod
    async def get_text_from_audio(cls, path: str) -> str | None:
        return await asyncio.to_thread(cls._transcribe_file, path)
