from dao.basedao import BaseDao
from db.models.message_reaction import MessageReaction


class MessageReactionDao(BaseDao[MessageReaction]):
    model = MessageReaction
