import os
import asyncio
from aiogram import Bot, Dispatcher, types, F, BaseMiddleware
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo, FSInputFile, TelegramObject, InlineKeyboardMarkup, InlineKeyboardButton
from sqlalchemy.orm import Session
from typing import Callable, Dict, Any, Awaitable
from database import SessionLocal, init_db
from models import User, Subscription, BotStatus

TOKEN = os.getenv("BOT_TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL", "").strip()
if WEBAPP_URL:
    if not WEBAPP_URL.startswith("http://") and not WEBAPP_URL.startswith("https://"):
        WEBAPP_URL = f"https://{WEBAPP_URL}"

# Admin telegram IDlari (faqat haqiqiy adminlar)
ADMIN_IDS = [7294699676]
_env_admin = os.getenv("ADMIN_TELEGRAM_ID", "").strip()
if _env_admin and _env_admin.isdigit():
    ADMIN_IDS.append(int(_env_admin))

if not TOKEN:
    print("\n[!] XATOLIK: BOT_TOKEN o'zgaruvchisi topilmadi!")
    print("[!] Railway Variables bo'limida BOT_TOKEN ni o'rnating.\n")

bot = Bot(token=TOKEN) if TOKEN else None
dp = Dispatcher()

# Majburiy obuna kanallari (Masalan: @channel1,@channel2)
REQUIRED_CHANNELS = os.getenv("REQUIRED_CHANNELS", "").strip()
CHANNELS = [ch.strip() for ch in REQUIRED_CHANNELS.split(",") if ch.strip()]


# ---------------------------------------------------------------------------
# BOT STATUS HELPER
# ---------------------------------------------------------------------------
def is_bot_restricted() -> tuple[bool, str]:
    """DB dan bot holatini tekshirish"""
    try:
        db: Session = SessionLocal()
        status = db.query(BotStatus).first()
        db.close()
        if status and status.is_restricted:
            return True, status.restriction_message
    except Exception as e:
        print(f"[Bot status check error]: {e}")
    return False, ""


# ---------------------------------------------------------------------------
# MIDDLEWARE - Bot cheklash
# ---------------------------------------------------------------------------
class BotRestrictionMiddleware(BaseMiddleware):
    """Oddiy foydalanuvchilar uchun bot cheklash middleware"""

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any]
    ) -> Any:
        # Foydalanuvchi IDini olish
        user_id = None
        if isinstance(event, types.Message):
            user_id = event.from_user.id if event.from_user else None
        elif isinstance(event, types.CallbackQuery):
            user_id = event.from_user.id if event.from_user else None

        # Admin tekshirish
        if user_id and user_id in ADMIN_IDS:
            return await handler(event, data)

        # Bot holatini tekshirish
        if user_id:
            restricted, msg = is_bot_restricted()
            if restricted:
                try:
                    if isinstance(event, types.Message):
                        await event.answer(msg)
                    elif isinstance(event, types.CallbackQuery):
                        await event.answer(msg[:200], show_alert=True)
                except Exception:
                    pass
                return  # Handler ni chaqirmaymiz

        return await handler(event, data)


# ---------------------------------------------------------------------------
# MIDDLEWARE - Majburiy Obuna (Mandatory Channel Subscription)
# ---------------------------------------------------------------------------
def get_subscription_kb(channels: list):
    keyboard = []
    for idx, channel in enumerate(channels):
        # Username yoki to'liq linklarni to'g'ri formatlash
        username = channel.replace("@", "")
        url = f"https://t.me/{username}"
        keyboard.append([InlineKeyboardButton(text=f"📢 {idx+1}-kanalga a'zo bo'lish", url=url)])
    keyboard.append([InlineKeyboardButton(text="✅ Obunani tekshirish", callback_data="check_sub")])
    return InlineKeyboardMarkup(inline_keyboard=keyboard)


class SubscriptionMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any]
    ) -> Any:
        if not CHANNELS:
            return await handler(event, data)

        user_id = None
        if isinstance(event, types.Message):
            user_id = event.from_user.id if event.from_user else None
        elif isinstance(event, types.CallbackQuery):
            user_id = event.from_user.id if event.from_user else None
            # Obunani tekshirish tugmasini doim o'tkazib yuboramiz
            if event.data == "check_sub":
                return await handler(event, data)

        if not user_id:
            return await handler(event, data)

        # Adminlarni tekshirmaymiz
        if user_id in ADMIN_IDS:
            return await handler(event, data)

        # Obunalarni tekshirish
        subscribed = True
        for channel in CHANNELS:
            try:
                member = await bot.get_chat_member(chat_id=channel, user_id=user_id)
                if member.status not in ["creator", "administrator", "member", "restricted"]:
                    subscribed = False
                    break
            except Exception as e:
                # Bot kanalda admin bo'lmasa yoki boshqa xatolik yuz bersa
                print(f"[Subscription Check Error] {channel}: {e}")

        if not subscribed:
            if isinstance(event, types.Message):
                await event.answer(
                    "⚠️ Botdan foydalanish uchun quyidagi majburiy kanallarga a'zo bo'lishingiz kerak:",
                    reply_markup=get_subscription_kb(CHANNELS)
                )
            elif isinstance(event, types.CallbackQuery):
                await event.answer(
                    "⚠️ Iltimos, avval majburiy kanallarga a'zo bo'ling!",
                    show_alert=True
                )
            return  # Handler ishga tushmaydi

        return await handler(event, data)


# Middlewareni ro'yxatdan o'tkazish
dp.message.middleware(BotRestrictionMiddleware())
dp.callback_query.middleware(BotRestrictionMiddleware())
dp.message.middleware(SubscriptionMiddleware())
dp.callback_query.middleware(SubscriptionMiddleware())


# ---------------------------------------------------------------------------
# HANDLER - Obunani Tekshirish Callback
# ---------------------------------------------------------------------------
@dp.callback_query(F.data == "check_sub")
async def check_subscription_callback(callback: types.CallbackQuery):
    user_id = callback.from_user.id
    subscribed = True
    for channel in CHANNELS:
        try:
            member = await bot.get_chat_member(chat_id=channel, user_id=user_id)
            if member.status not in ["creator", "administrator", "member", "restricted"]:
                subscribed = False
                break
        except Exception as e:
            print(f"[Callback Subscription Check Error] {channel}: {e}")
            
    if subscribed:
        await callback.message.edit_text(
            "✅ Rahmat! Siz barcha majburiy kanallarga muvaffaqiyatli obuna bo'ldingiz.\n"
            "Endi botdan bemalol foydalanishingiz mumkin.",
            reply_markup=None
        )
        await callback.message.answer(
            "Bot ishga tushdi. Quyidagi menyudan foydalanishingiz mumkin:",
            reply_markup=get_main_kb()
        )
        await callback.answer()
    else:
        await callback.answer(
            "❌ Siz hali barcha kanallarga a'zo bo'lmadingiz. Iltimos, a'zo bo'ling va qaytadan tekshiring.",
            show_alert=True
        )


# ---------------------------------------------------------------------------
# FSM STATES
# ---------------------------------------------------------------------------
class Form(StatesGroup):
    waiting_for_group = State()
    waiting_for_sub_group = State()
    waiting_for_time = State()


# ---------------------------------------------------------------------------
# KEYBOARD
# ---------------------------------------------------------------------------
def get_main_kb():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📅 Dars Jadvali"), KeyboardButton(text="🔔 Obuna Bo'lish")],
        ],
        resize_keyboard=True
    )


# ---------------------------------------------------------------------------
# HANDLERS
# ---------------------------------------------------------------------------
@dp.message(Command("start"))
async def start(message: types.Message):
    try:
        db: Session = SessionLocal()
        user = db.query(User).filter(User.telegram_id == message.from_user.id).first()
        if not user:
            user = User(
                telegram_id=message.from_user.id,
                first_name=message.from_user.first_name,
                username=message.from_user.username
            )
            db.add(user)
            db.commit()
        db.close()
        
        await message.answer(
            f"Assalomu alaykum, {message.from_user.first_name}! \nTSUE Study Assistant botiga xush kelibsiz.",
            reply_markup=get_main_kb()
        )
    except Exception as e:
        await message.answer(f"⚠️ Botda ichki xatolik yuz berdi: {str(e)}")
        print(f"DEBUG START ERROR: {e}")


# --- Dars Jadvali ---
@dp.message(F.text == "📅 Dars Jadvali")
async def ask_group(message: types.Message, state: FSMContext):
    await message.answer("Guruh nomini kiriting (masalan: II-53/24):")
    await state.set_state(Form.waiting_for_group)


@dp.message(Form.waiting_for_group)
async def send_timetable(message: types.Message, state: FSMContext):
    from timetable_engine import get_timetable_screenshot
    group = message.text.strip()
    await message.answer(f"Xo'sh, {group} guruhi uchun jadvalni tayyorlayapman... ⏳")
    
    screenshot_path = await get_timetable_screenshot(group)
    if screenshot_path and os.path.exists(screenshot_path):
        await message.answer_photo(
            photo=FSInputFile(screenshot_path),
            caption=f"📅 {group} guruhi uchun dars jadvali"
        )
        os.remove(screenshot_path)
    else:
        await message.answer("Kechirasiz, jadvalni topib bo'lmadi. Guruh nomini to'g'ri kiritganingizni tekshiring.")
    
    await state.clear()


# --- Obuna Bo'lish ---
@dp.message(F.text == "🔔 Obuna Bo'lish")
async def sub_ask_group(message: types.Message, state: FSMContext):
    await message.answer("Obuna bo'lish uchun guruh nomini kiriting:")
    await state.set_state(Form.waiting_for_sub_group)


@dp.message(Form.waiting_for_sub_group)
async def sub_ask_time(message: types.Message, state: FSMContext):
    await state.update_data(group=message.text.strip())
    await message.answer("Har kuni dars jadvali soat nechada kelsin? (Masalan: 08:00)")
    await state.set_state(Form.waiting_for_time)


@dp.message(Form.waiting_for_time)
async def save_sub(message: types.Message, state: FSMContext):
    time = message.text.strip()
    data = await state.get_data()
    group = data['group']
    
    db: Session = SessionLocal()
    user = db.query(User).filter(User.telegram_id == message.from_user.id).first()
    if user:
        sub = db.query(Subscription).filter(Subscription.user_id == user.id).first()
        if sub:
            sub.group_name = group
            sub.notification_time = time
        else:
            sub = Subscription(user_id=user.id, group_name=group, notification_time=time)
            db.add(sub)
        db.commit()
    db.close()
    
    await message.answer(f"Muvaffaqiyatli! Endi har kuni soat {time} da sizga {group} guruhi jadvali yuboriladi.")
    await state.clear()


async def run_bot():
    if not bot:
        print("[!] Bot obyekti yaratilmagan, polling boshlanmadi.")
        return
    init_db()
    print("[+] Telegram bot polling boshlandi...")
    await dp.start_polling(bot)
