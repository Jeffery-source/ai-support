from fastapi import FastAPI,Request,HTTPException,Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import JSONResponse
import uuid
from sqlalchemy.orm import Session
from .db import engine, SessionLocal
from .models import Base, ChatSession, ChatMessage
from sqlalchemy import select

app = FastAPI(title="AI Support Backend")

Base.metadata.create_all(bind=engine)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],   # 包含 OPTIONS/POST 等
    allow_headers=["*"],   # 允许 Content-Type 等
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
class ChatIn(BaseModel):
    message: str
    session_id: str | None = None

@app.get("/api/sessions/{session_id}/messages")
def get_messages(session_id: str, db: Session = Depends(get_db)):
    s = db.get(ChatSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    stmt = (
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )

    rows = db.execute(stmt).scalars().all()
    return {
        "session_id": session_id,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat(),
            }
            for m in rows
        ],
    }

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/api/chat")
def chat(payload: ChatIn, db: Session = Depends(get_db)):

    # 1. 如果前端带了 session_id -> 校验
    if payload.session_id:
        s = db.get(ChatSession, payload.session_id)
        if not s:
            raise HTTPException(status_code=404, detail="Session not found")

    # 2. 如果没带 -> 后端生成新的
    else:
        s = ChatSession(id=str(uuid.uuid4()))
        db.add(s)
        db.commit()
        db.refresh(s)

    # 3. 写入用户消息
    db.add(ChatMessage(
        session_id=s.id,
        role="user",
        content=payload.message
    ))

    # 4. mock 回复
    reply_text = f"（mock）我收到了：{payload.message}"

    db.add(ChatMessage(
        session_id=s.id,
        role="assistant",
        content=reply_text
    ))

    db.commit()

    # 5. 每次响应都返回 session_id
    return {
        "session_id": s.id,
        "reply": reply_text
    }

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    resp = JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "Something went wrong."}},
    )
    # 强制把 CORS 头补上（防止异常路径丢头）
    origin = request.headers.get("origin")
    if origin in {"http://localhost:5173", "http://127.0.0.1:5173"}:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
    return resp

