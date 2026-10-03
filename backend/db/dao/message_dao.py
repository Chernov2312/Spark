from db.dao.basedao import BaseDao
from db.models import Message


class MessageDao(BaseDao[Message]):
    model = Message
