import asyncio
import datetime
import os
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Subscription, User
from timetable_engine import get_timetable_screenshot
from aiogram import Bot
from aiogram.types import FSInputFile

TOKEN = os.getenv("BOT_TOKEN")
bot = Bot(token=TOKEN) if TOKEN else None

async def check_and_send_notifications():
    """
    Har daqiqa ishga tushadi va obunalarni tekshiradi.
    """
    while True:
        now = datetime.datetime.now()
        current_time = now.strftime("%H:%M")
        
        db: Session = SessionLocal()
        # Hozirgi vaqtda yuborilishi kerak bo'lgan obunalarni olish
        subs = db.query(Subscription).filter(Subscription.notification_time == current_time).all()
        
        for sub in subs:
            try:
                user = db.query(User).filter(User.id == sub.user_id).first()
                if user and bot:
                    print(f"Sending daily timetable to {user.telegram_id} for group {sub.group_name}")
                    screenshot_path = await get_timetable_screenshot(sub.group_name)
                    if screenshot_path and os.path.exists(screenshot_path):
                        await bot.send_photo(
                            chat_id=user.telegram_id,
                            photo=FSInputFile(screenshot_path),
                            caption=f"🔔 Xayrli kun! {sub.group_name} guruhi uchun bugungi dars jadvali."
                        )
                        os.remove(screenshot_path)
            except Exception as e:
                print(f"Error sending sub: {e}")
        
        db.close()
        
        # Keyingi daqiqagacha kutish
        await asyncio.sleep(60)

if __name__ == "__main__":
    asyncio.run(check_and_send_notifications())
