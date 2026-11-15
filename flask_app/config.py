import os

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key-fullres-scraper')
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16 MB max request payload
    SCRAPER_TIMEOUT = int(os.environ.get('SCRAPER_TIMEOUT', 15))
    MAX_IMAGES_PER_REQUEST = int(os.environ.get('MAX_IMAGES_PER_REQUEST', 200))
