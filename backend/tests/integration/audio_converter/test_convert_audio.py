from pathlib import Path
import shutil
import subprocess

import pytest

from core.converter_audio import AudioConverter


def ffmpeg_tools_work():
    for executable in ("ffmpeg", "ffprobe"):
        path = shutil.which(executable)
        if path is None:
            return False
        try:
            result = subprocess.run(
                [path, "-version"],
                capture_output=True,
                check=False,
                timeout=5,
            )
        except (OSError, subprocess.TimeoutExpired):
            return False
        if result.returncode != 0:
            return False
    return True


@pytest.mark.skipif(
    not ffmpeg_tools_work(),
    reason="working FFmpeg and ffprobe executables are required for audio conversion",
)
async def test_convert():
    res = AudioConverter.get_text_from_audio(
        str(Path(__file__).resolve().with_name("audio.ogg")),
    )
    assert res is not None
