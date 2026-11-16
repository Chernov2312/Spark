from celery import chain

from tasks.config_celery import celery_app
from tasks.message import add_messages_in_db
from tasks.message_reactions import add_reactions_in_db


@celery_app.task
def master_sync_scheduler():
    chain(add_messages_in_db.si() | add_reactions_in_db.si()).apply_async()
