import re
import unicodedata


# Make visually similar Cyrillic and Greek letters resolve to the Latin tag.
_CONFUSABLES = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y",
    "х": "x", "к": "k", "м": "m", "т": "t", "в": "b", "н": "h",
    "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ց": "g",
    "Α": "a", "Β": "b", "Ε": "e", "Ζ": "z", "Η": "h", "Ι": "i",
    "Κ": "k", "Μ": "m", "Ν": "n", "Ο": "o", "Ρ": "p", "Τ": "t",
    "Υ": "y", "Χ": "x", "α": "a", "β": "b", "ε": "e", "ι": "i",
    "κ": "k", "ο": "o", "ρ": "p", "τ": "t", "υ": "y", "χ": "x",
    "б": "b", "г": "g", "д": "d", "ё": "e", "ж": "zh", "з": "z",
    "й": "i", "л": "l", "ф": "f", "ц": "c", "ч": "ch", "ш": "sh",
    "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
    "я": "ya",
})


def normalize_user_tag(value: str) -> str:
    """Return a lowercase ASCII handle, folding common lookalike letters."""
    value = unicodedata.normalize("NFKC", value).translate(_CONFUSABLES).casefold()
    value = value.removeprefix("@")
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-z0-9_]", "", value)
    return value[:32].strip("_") or "user"
