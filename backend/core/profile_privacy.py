import uuid

from core.user_tags import normalize_user_tag
from db.models import User


def can_view_profile_field(
    owner: User,
    viewer_id: uuid.UUID,
    viewer_tag: str,
    field: str,
    *,
    viewer_is_friend: bool,
) -> bool:
    if owner.id == viewer_id:
        return True
    visibility = owner.profile_visibility or {}
    exceptions = owner.profile_exceptions or {}
    denied_tags = {
        normalize_user_tag(tag)
        for tag in exceptions.get(field, [])
        if isinstance(tag, str)
    }
    if normalize_user_tag(viewer_tag) in denied_tags:
        return False
    rule = visibility.get(field, "everyone")
    return rule == "everyone" or (rule == "friends" and viewer_is_friend)
