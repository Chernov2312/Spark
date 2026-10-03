from db.dao.basedao import BaseDao
from db.models import MessageReaction


class MessageReactionDao(BaseDao[MessageReaction]):
    model = MessageReaction
