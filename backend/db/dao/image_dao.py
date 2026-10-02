from db.dao.basedao import BaseDao
from db.models.image import Image


class ImageDao(BaseDao[Image]): ...
