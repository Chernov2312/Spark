from pathlib import Path

from core.converter_audio import AudioConverter


async def test_convert():
    res = AudioConverter.get_text_from_audio(
        str(Path(__file__).resolve().with_name("audio.ogg")),
    )
    assert res is not None
