import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Railway Persistent Volume yo'li
DB_PATH = "/data/quiz_bot.db" if os.path.exists("/data") else "./quiz_bot.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

# SQLite uchun High-load (WAL mode) sozlamalari
from sqlalchemy import event
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def init_db():
    """Barcha jadvallarni yaratadi (agar mavjud bo'lmasa)"""
    from models import User, Quiz, Question, Result, Subscription, BotStatus, BotLog  # noqa
    Base.metadata.create_all(bind=engine)
    print(f"[+] Database initialized: {DB_PATH}")

def get_db():
    """FastAPI dependency injection uchun DB sessiyasi"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
