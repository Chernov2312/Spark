from dao.basedao import BaseDao
from db.models.message import Message


class MessageDao(BaseDao[Message]):
    model = Message
