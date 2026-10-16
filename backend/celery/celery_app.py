from celery import Celery

app = Celery('example', broker='your_broker_url_here')

@app.task
def add(x, y):
    return x + y