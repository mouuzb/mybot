import sqlite3
import os

DB_PATH = "/data/quiz_bot.db" if os.path.exists("/data") else "./quiz_bot.db"

def migrate():
    if not os.path.exists(DB_PATH):
        print("Database does not exist yet. No migration needed.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    print(f"Checking for migrations in: {DB_PATH}")
    
    # users jadvaliga is_admin qo'shish
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0")
        print("[+] Added is_admin to users table")
    except Exception as e: 
        if "duplicate column name" in str(e).lower(): pass
        else: print(f"[-] users error: {e}")
    
    # results jadvaliga kerakli ustunlarni qo'shish
    cols_to_add = [
        ("quiz_code", "TEXT"),
        ("date", "DATETIME"),
        ("chunk_range", "TEXT")
    ]
    
    for col_name, col_type in cols_to_add:
        try:
            cursor.execute(f"ALTER TABLE results ADD COLUMN {col_name} {col_type}")
            print(f"[+] Added {col_name} to results table")
        except Exception as e:
            if "duplicate column name" in str(e).lower(): pass
            else: print(f"[-] results error ({col_name}): {e}")
            
    # quizzes jadvaliga title qo'shish
    try:
        cursor.execute("ALTER TABLE quizzes ADD COLUMN title TEXT")
        print("[+] Added title to quizzes table")
    except Exception as e:
        if "duplicate column name" in str(e).lower(): pass
        else: print(f"[-] quizzes error: {e}")

    conn.commit()
    conn.close()
    print("Migration step completed.")

if __name__ == "__main__":
    migrate()
