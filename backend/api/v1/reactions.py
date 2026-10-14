import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from schemas.reactions import ReactionsPostResponse



reactions_router = APIRouter(prefix="/api/v1", tags=[RouteTags.REACTIONS])

# @reactions_router.post("messages/{message_id}/reactions")
# async def post_reactions(
#     message_id: uuid.UUID,
#     data : ReactionsPostResponse
# ):
    
    


