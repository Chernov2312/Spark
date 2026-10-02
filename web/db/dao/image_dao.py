from db.models.image import Image
from web.db.dao.basedao import BaseDao


class ImageDao(BaseDao[Image]): ...
