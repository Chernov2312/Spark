from db.dao.basedao import BaseDao
from db.models import Image


class ImageDao(BaseDao[Image]):
    model = Image
