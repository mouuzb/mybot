import asyncio
import os
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from api import router as api_router
from bot import run_bot
from scheduler import check_and_send_notifications

print(f"[+] PORT = {os.getenv('PORT', '8000')}")
print(f"[+] BOT_TOKEN = {'SET' if os.getenv('BOT_TOKEN') else 'NOT SET!'}")
print(f"[+] WEBAPP_URL = {os.getenv('WEBAPP_URL', 'NOT SET')}")

app = FastAPI()

# Static fayllarni ulash
if not os.path.exists("static"):
    os.makedirs("static")
app.mount("/static", StaticFiles(directory="static"), name="static")

# API routerini ulash
app.include_router(api_router, prefix="/api")

@app.get("/")
async def serve_index():
    from fastapi.responses import FileResponse
    return FileResponse("static/index.html")

async def start_all():
    # Bot, Server va Scheduler'ni birga ishga tushirish
    config = uvicorn.Config(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
    server = uvicorn.Server(config)
    
    # Hammasini parallel ishga tushirish
    try:
        results = await asyncio.gather(
            server.serve(),
            run_bot(),
            check_and_send_notifications(),
            return_exceptions=True
        )
        # Xatolarni chiqarish
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                task_names = ["Server", "Bot", "Scheduler"]
                print(f"[!] {task_names[i]} XATO: {result}")
    except Exception as e:
        print(f"[!] Tizimda xatolik: {e}")

if __name__ == "__main__":
    asyncio.run(start_all())

