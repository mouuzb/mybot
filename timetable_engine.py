import asyncio
import os
import time
from playwright.async_api import async_playwright

# High-load uchun: Bir vaqtda faqat 2 ta brauzer ochiladi
browser_semaphore = asyncio.Semaphore(2)

async def get_timetable_screenshot(group_name: str) -> str | None:
    """
    tsue.edupage.org saytidan guruh jadvalini screenshot qiladi.
    Kesh va Semaphore bilan optimallashtirilgan.
    """
    output_path = f"static/timetable_{group_name.replace('/', '_')}.png"

    # 1. Keshni tekshirish (1 soat davomida amal qiladi)
    if os.path.exists(output_path):
        mtime = os.path.getmtime(output_path)
        if time.time() - mtime < 3600: # 3600 sekund = 1 soat
            print(f"[Timetable] Using cached image for {group_name}")
            return output_path

    # 2. Semaphore orqali navbatga turish
    async with browser_semaphore:
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--single-process",
                    ]
                )
                page = await browser.new_page(viewport={"width": 1280, "height": 900})

                print(f"[Timetable] Fetching from site: {group_name}")
                await page.goto("https://tsue.edupage.org/timetable/", wait_until="domcontentloaded", timeout=25000)

                # 1. "Sinflar" menyusini bosish
                try:
                    await page.click(".as-menu-item-label", timeout=4000)
                except Exception:
                    try:
                        await page.click("text=Sinflar", timeout=3000)
                    except Exception:
                        pass

                # 2. Guruhni topish va tanlash
                try:
                    await page.wait_for_selector(f"text={group_name}", timeout=4000)
                    await page.click(f"text={group_name}")
                except Exception:
                    await page.keyboard.type(group_name)
                    await page.keyboard.press("Enter")

                # 3. Jadval yuklanishini kutish
                try:
                    await page.wait_for_selector("div.print-nobreak, .timetable", timeout=5000)
                except Exception:
                    pass

                await page.wait_for_timeout(1000)
                
                # Screenshot olish
                target = await page.query_selector("div.print-nobreak") or await page.query_selector(".timetable")
                if target:
                    await target.screenshot(path=output_path)
                    print(f"[Timetable] Screenshot saved: {group_name}")
                else:
                    await page.screenshot(path=output_path)
                    print("[Timetable] Full page fallback used")

                await browser.close()
                return output_path

        except Exception as e:
            print(f"[Timetable] Error during extraction: {e}")
            return None
