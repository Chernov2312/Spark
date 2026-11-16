import os
from typing import Optional
import uuid

from pydub import AudioSegment, effects
import whisper


class AudioConverter:
    __model = whisper.load_model("base")

    @staticmethod
    def __normilize_file(path: str) -> Optional[str]:
        if not os.path.exists(path):
            return None
        audio = AudioSegment.from_file(path)
        audio = audio.set_channels(1).set_frame_rate(16000)
        normalized = effects.normalize(audio)
        out = f"/tmp/res_{uuid.uuid4()}.wav"
        normalized.export(out, format="wav")
        return out

    @classmethod
    def get_text_from_audio(cls, path: str) -> Optional[str]:
        res_path = AudioConverter.__normilize_file(path)
        if res_path is None:
            return None
        try:
            return cls.__model.transcribe(res_path)["text"]
        finally:
            os.remove(res_path)
