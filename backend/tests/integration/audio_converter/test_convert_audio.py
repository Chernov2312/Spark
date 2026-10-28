from core.converter_audio import AudioConverter


async def test_convert():
    res = AudioConverter.get_text_from_audio(
        "tests/integration/audio_converter/audio.ogg",
    )
    assert res is not None
