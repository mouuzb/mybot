from pydantic import BaseModel
from typing import List, Optional

class QuestionCreate(BaseModel):
    text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_option: str

class QuizCreate(BaseModel):
    telegram_id: int
    title: str # Fan nomi
    timer_per_question: int
    questions: List[QuestionCreate]

class SubmitResult(BaseModel):
    telegram_id: int
    quiz_code: str
    chunk_range: str
    correct_count: int
    incorrect_count: int

class AuthUser(BaseModel):
    telegram_id: int
    first_name: str
    username: Optional[str] = None
