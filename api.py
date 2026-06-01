from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
import random
import string
import os
import asyncio
import datetime

from database import get_db
import models
import schemas

router = APIRouter()

# Admin ID lari (Haqiqiy va Test)
ALLOWED_ADMINS = ["7294699676", os.getenv("ADMIN_TELEGRAM_ID", "").strip()]

# ---------------------------------------------------------------------------
# YORDAMCHI: Bot status olish / yaratish
# ---------------------------------------------------------------------------
def get_or_create_bot_status(db: Session) -> models.BotStatus:
    status = db.query(models.BotStatus).first()
    if not status:
        status = models.BotStatus()
        db.add(status)
        db.commit()
        db.refresh(status)
    return status


# ---------------------------------------------------------------------------
# QUIZ ENDPOINTS
# ---------------------------------------------------------------------------
@router.post("/auth")
def auth_user(auth_data: schemas.AuthUser, db: Session = Depends(get_db)):
    """Userni yangilash yoki qo'shish va tizim holatini tekshirish"""
    user = db.query(models.User).filter(models.User.telegram_id == auth_data.telegram_id).first()
    if not user:
        user = models.User(
            telegram_id=auth_data.telegram_id,
            first_name=auth_data.first_name,
            username=auth_data.username
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.first_name = auth_data.first_name
        user.username = auth_data.username
        db.commit()

    # Bot holati
    status = db.query(models.BotStatus).first()
    is_restricted = status.is_restricted if status else False
    restriction_message = status.restriction_message if status else "⚠️ Hozirda botda vaqtinchalik texnik ishlar olib borilmoqda."

    # Adminligini tekshirish
    is_admin = (str(auth_data.telegram_id).strip() in ALLOWED_ADMINS) or (user.is_admin if user else False)

    return {
        "status": "ok",
        "is_restricted": is_restricted,
        "restriction_message": restriction_message,
        "is_admin": is_admin
    }


@router.post("/quiz")
def create_quiz(quiz_data: schemas.QuizCreate, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.telegram_id == quiz_data.telegram_id).first()
    if not user:
        user = models.User(telegram_id=quiz_data.telegram_id, first_name="Mehmon")
        db.add(user)
        db.commit()
        db.refresh(user)

    code = ''.join(random.choices(string.digits, k=6))
    while db.query(models.Quiz).filter(models.Quiz.code == code).first():
        code = ''.join(random.choices(string.digits, k=6))

    new_quiz = models.Quiz(
        code=code,
        title=quiz_data.title,
        creator_id=user.id,
        timer_per_question=quiz_data.timer_per_question
    )
    db.add(new_quiz)
    db.commit()
    db.refresh(new_quiz)

    for q in quiz_data.questions:
        new_q = models.Question(
            quiz_id=new_quiz.id,
            text=q.text,
            option_a=q.option_a,
            option_b=q.option_b,
            option_c=q.option_c,
            option_d=q.option_d,
            correct_option=q.correct_option
        )
        db.add(new_q)
    
    db.commit()
    return {"code": code}


@router.get("/quiz/{code}/meta")
def get_quiz_meta(code: str, db: Session = Depends(get_db)):
    """Faqat metadata — savollarni yuklamaydi (tez)"""
    quiz = db.query(models.Quiz).filter(models.Quiz.code == code).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz topilmadi")
    total_count = db.query(models.Question).filter(models.Question.quiz_id == quiz.id).count()
    return {
        "id": quiz.id,
        "code": quiz.code,
        "title": quiz.title,
        "total_questions": total_count,
        "timer_per_question": quiz.timer_per_question
    }


@router.get("/quiz/{code}")
def get_quiz(code: str, start: int = 1, end: int = 25, db: Session = Depends(get_db)):
    quiz = db.query(models.Quiz).filter(models.Quiz.code == code).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz topilmadi")
    
    all_questions = sorted(quiz.questions, key=lambda x: x.id)
    total_count = len(all_questions)
    
    selected_questions = all_questions[start-1:end]
    
    # Savollarni random tartibda aralashtirish
    random.shuffle(selected_questions)
    
    questions_data = []
    for q in selected_questions:
        options = [
            ("a", q.option_a),
            ("b", q.option_b),
            ("c", q.option_c),
            ("d", q.option_d)
        ]
        
        correct_text = ""
        if q.correct_option.lower() == "a": correct_text = q.option_a
        elif q.correct_option.lower() == "b": correct_text = q.option_b
        elif q.correct_option.lower() == "c": correct_text = q.option_c
        elif q.correct_option.lower() == "d": correct_text = q.option_d
        
        # Variantlarni ham aralashtirish
        random.shuffle(options)
        
        new_q = {
            "text": q.text,
            "option_a": options[0][1],
            "option_b": options[1][1],
            "option_c": options[2][1],
            "option_d": options[3][1],
            "correct_option": ""
        }
        
        for idx, opt_pair in enumerate(options):
            if opt_pair[1] == correct_text:
                new_q["correct_option"] = ["a", "b", "c", "d"][idx]
                break
        
        questions_data.append(new_q)
        
    return {
        "id": quiz.id,
        "code": quiz.code,
        "title": quiz.title,
        "total_questions": total_count,
        "timer_per_question": quiz.timer_per_question,
        "questions": questions_data
    }


@router.post("/result")
def submit_result(res_data: schemas.SubmitResult, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.telegram_id == res_data.telegram_id).first()
    if not user:
        user = models.User(telegram_id=res_data.telegram_id, first_name="Mehmon")
        db.add(user)
        db.commit()
        db.refresh(user)
        
    new_res = models.Result(
        user_id=user.id,
        quiz_code=res_data.quiz_code,
        chunk_range=res_data.chunk_range,
        correct_count=res_data.correct_count,
        incorrect_count=res_data.incorrect_count
    )
    db.add(new_res)
    db.commit()
    return {"status": "success"}


@router.get("/results/{telegram_id}")
def get_results(telegram_id: int, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.telegram_id == telegram_id).first()
    if not user:
        return []

    results = db.query(models.Result).filter(models.Result.user_id == user.id).order_by(desc(models.Result.date)).all()
    
    return [
        {
            "quiz_code": r.quiz_code,
            "chunk_range": r.chunk_range,
            "correct_count": r.correct_count,
            "incorrect_count": r.incorrect_count,
            "date": r.date.isoformat() + "Z" if r.date else None
        } for r in results
    ]


@router.get("/public/quizzes")
def get_public_quizzes(db: Session = Depends(get_db)):
    quizzes = db.query(models.Quiz).order_by(desc(models.Quiz.created_at)).limit(20).all()
    
    result_data = []
    for q in quizzes:
        result_data.append({
            "code": q.code,
            "title": q.title or "Noma'lum fan",
            "created_at": (q.created_at + datetime.timedelta(hours=5)).strftime("%Y-%m-%d %H:%M") if q.created_at else "",
            "total_questions": len(q.questions)
        })
    return result_data


# ---------------------------------------------------------------------------
# ADMIN ENDPOINTS
# ---------------------------------------------------------------------------
@router.get("/admin/check/{telegram_id}")
def check_admin(telegram_id: str, password: str = None):
    is_admin_user = (telegram_id.strip() in ALLOWED_ADMINS)
    if password:
        return {"is_admin": is_admin_user and password == "1213"}
    return {"is_admin": is_admin_user}


@router.get("/admin/users")
def get_admin_users(telegram_id: str, db: Session = Depends(get_db)):
    if telegram_id.strip() not in ALLOWED_ADMINS:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    users = db.query(models.User).order_by(desc(models.User.joined_at)).all()
    return [
        {
            "id": u.id,
            "telegram_id": u.telegram_id,
            "first_name": u.first_name,
            "username": u.username or "",
            "is_admin": u.is_admin,
            "joined_at": u.joined_at.isoformat() + "Z" if u.joined_at else None
        } for u in users
    ]


@router.get("/admin/quizzes")
def get_admin_quizzes(telegram_id: str, db: Session = Depends(get_db)):
    if telegram_id.strip() not in ALLOWED_ADMINS:
        raise HTTPException(status_code=403, detail="Forbidden")

    quizzes = db.query(models.Quiz).order_by(desc(models.Quiz.created_at)).all()
    
    result_data = []
    for q in quizzes:
        creator = db.query(models.User).filter(models.User.id == q.creator_id).first()
        results = db.query(models.Result).filter(models.Result.quiz_code == q.code).all()
        
        participants = []
        for r in results:
            p_user = db.query(models.User).filter(models.User.id == r.user_id).first()
            participants.append({
                "first_name": p_user.first_name if p_user else "Noma'lum",
                "username": p_user.username if p_user else "",
                "chunk_range": r.chunk_range,
                "correct": r.correct_count,
                "incorrect": r.incorrect_count,
                "date": (r.date + datetime.timedelta(hours=5)).strftime("%Y-%m-%d %H:%M") if r.date else ""
            })
            
        result_data.append({
            "code": q.code,
            "title": q.title or "Noma'lum fan",
            "created_at": (q.created_at + datetime.timedelta(hours=5)).strftime("%Y-%m-%d %H:%M") if q.created_at else "",
            "creator_name": creator.first_name if creator else "Noma'lum",
            "creator_username": creator.username if creator else "",
            "total_questions": len(q.questions),
            "participants": participants
        })
        
    return result_data


@router.delete("/admin/quiz/{code}")
def delete_quiz(code: str, telegram_id: str, db: Session = Depends(get_db)):
    if telegram_id.strip() not in ALLOWED_ADMINS:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    quiz = db.query(models.Quiz).filter(models.Quiz.code == code).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz topilmadi")
    
    db.delete(quiz)
    db.commit()
    return {"status": "success"}


# ---------------------------------------------------------------------------
# BOT CONTROL ENDPOINTS
# ---------------------------------------------------------------------------
@router.get("/admin/bot-status")
def get_bot_status(telegram_id: str, db: Session = Depends(get_db)):
    """Bot joriy holatini olish"""
    if telegram_id.strip() not in ALLOWED_ADMINS:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    status = get_or_create_bot_status(db)
    return {
        "is_restricted": status.is_restricted,
        "restriction_message": status.restriction_message,
        "open_broadcast_message": status.open_broadcast_message,
        "updated_at": status.updated_at.isoformat() if status.updated_at else None
    }


@router.post("/admin/bot-restrict")
async def restrict_bot(
    telegram_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Botni cheklash - oddiy userlarga texnik ishlar xabari yuborish"""
    if telegram_id.strip() not in ALLOWED_ADMINS:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    status = get_or_create_bot_status(db)
    status.is_restricted = True
    status.updated_at = datetime.datetime.utcnow()
    db.commit()
    
    # Log saqlash
    log = models.BotLog(
        action="restrict",
        admin_telegram_id=int(telegram_id),
        note="Bot cheklangan"
    )
    db.add(log)
    db.commit()
    
    # Fon rejimida xabar yuborish
    background_tasks.add_task(broadcast_restriction_message, status.restriction_message, int(telegram_id))
    
    return {"status": "restricted", "message": "Bot cheklandi, xabarlar yuborilmoqda..."}


@router.post("/admin/bot-open")
async def open_bot(
    telegram_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Botni ochish - barcha userlarga broadcast yuborish"""
    if telegram_id.strip() not in ALLOWED_ADMINS:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    status = get_or_create_bot_status(db)
    status.is_restricted = False
    status.updated_at = datetime.datetime.utcnow()
    db.commit()
    
    # Log saqlash
    log = models.BotLog(
        action="open",
        admin_telegram_id=int(telegram_id),
        note="Bot qayta ochildi"
    )
    db.add(log)
    db.commit()
    
    # Fon rejimida broadcast yuborish
    background_tasks.add_task(broadcast_open_message, status.open_broadcast_message, int(telegram_id))
    
    return {"status": "open", "message": "Bot ochildi, broadcast yuborilmoqda..."}


@router.post("/admin/bot-broadcast")
async def send_broadcast(
    telegram_id: str,
    background_tasks: BackgroundTasks,
    body: dict,
    db: Session = Depends(get_db)
):
    """Maxsus broadcast xabar yuborish"""
    if telegram_id.strip() not in ALLOWED_ADMINS:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    message = body.get("message", "")
    if not message:
        raise HTTPException(status_code=400, detail="Xabar bo'sh bo'lishi mumkin emas")
    
    background_tasks.add_task(broadcast_custom_message, message, int(telegram_id))
    return {"status": "sending", "message": "Broadcast yuborilmoqda..."}


@router.put("/admin/bot-messages")
def update_bot_messages(
    telegram_id: str,
    body: dict,
    db: Session = Depends(get_db)
):
    """Texnik ishlar va broadcast xabarlarini tahrirlash"""
    if telegram_id.strip() not in ALLOWED_ADMINS:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    status = get_or_create_bot_status(db)
    
    if "restriction_message" in body:
        status.restriction_message = body["restriction_message"]
    if "open_broadcast_message" in body:
        status.open_broadcast_message = body["open_broadcast_message"]
    
    status.updated_at = datetime.datetime.utcnow()
    db.commit()
    return {"status": "updated"}


@router.get("/admin/bot-logs")
def get_bot_logs(telegram_id: str, db: Session = Depends(get_db)):
    """Bot start/stop loglarini olish"""
    if telegram_id.strip() not in ALLOWED_ADMINS:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    logs = db.query(models.BotLog).order_by(desc(models.BotLog.timestamp)).limit(50).all()
    return [
        {
            "id": l.id,
            "action": l.action,
            "admin_telegram_id": l.admin_telegram_id,
            "timestamp": l.timestamp.isoformat() + "Z" if l.timestamp else None,
            "note": l.note
        } for l in logs
    ]


# ---------------------------------------------------------------------------
# BROADCAST HELPER FUNKSIYALARI (fon rejimi)
# ---------------------------------------------------------------------------
async def _send_to_all_users(message_text: str, admin_id: int = 7294699676, action_type: str = "broadcast"):
    """Barcha userlarga xabar yuborish (flood limit bilan) va natijani BotLog ga yozish"""
    import os
    from database import SessionLocal
    
    bot_token = os.getenv("BOT_TOKEN")
    if not bot_token:
        print("[!] BOT_TOKEN yo'q, broadcast o'tkazib yuborildi")
        return
    
    try:
        import aiohttp
    except ImportError:
        print("[!] aiohttp kutubxonasi yo'q")
        return

    db = SessionLocal()
    try:
        users = db.query(models.User).all()
        total = len(users)
        sent = 0
        failed = 0
        
        print(f"[Broadcast] Jami {total} foydalanuvchiga yuborilmoqda...")
        
        async with aiohttp.ClientSession() as session:
            for user in users:
                try:
                    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
                    payload = {
                        "chat_id": user.telegram_id,
                        "text": message_text,
                        "parse_mode": "HTML"
                    }
                    async with session.post(url, json=payload) as resp:
                        if resp.status == 200:
                            sent += 1
                        else:
                            failed += 1
                    # Flood limit: har 0.05 sekundda 1 xabar (20 req/s)
                    await asyncio.sleep(0.05)
                except Exception as e:
                    failed += 1
                    print(f"[Broadcast] User {user.telegram_id} ga yuborib bo'lmadi: {e}")
        
        print(f"[Broadcast] Yakunlandi: yuborildi={sent}, xato={failed}, jami={total}")
        
        # Natijani BotLog jadvaliga saqlash
        log = models.BotLog(
            action=action_type,
            admin_telegram_id=admin_id,
            note=f"Yuborildi: {sent}, Xato: {failed}, Jami: {total}"
        )
        db.add(log)
        db.commit()
    finally:
        db.close()


async def broadcast_restriction_message(message_text: str, admin_id: int):
    """Texnik ishlar xabari yuborish"""
    await _send_to_all_users(message_text, admin_id, "restrict")


async def broadcast_open_message(message_text: str, admin_id: int):
    """Qayta ochilish xabari yuborish"""
    await _send_to_all_users(message_text, admin_id, "open")


async def broadcast_custom_message(message_text: str, admin_id: int):
    """Maxsus broadcast xabar yuborish"""
    await _send_to_all_users(message_text, admin_id, "broadcast")
