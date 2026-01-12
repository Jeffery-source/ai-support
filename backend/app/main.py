from fastapi import FastAPI,Request,HTTPException,Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import JSONResponse
import uuid
from sqlalchemy.orm import Session
from .db import engine, SessionLocal
from .models import Base, ChatSession, ChatMessage,LLMUsage
from sqlalchemy import select
from .llm import FakeProvider
from .rate_limit import fixed_window_limit

app = FastAPI(title="AI Support Backend")
provider = FakeProvider(model="fake-1")
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
def chat(payload: ChatIn,request: Request,db: Session = Depends(get_db)):
    
    # 取客户端 IP（优先 X-Forwarded-For，方便未来上云/反代）
    xff = request.headers.get("x-forwarded-for")
    client_ip = (xff.split(",")[0].strip() if xff else request.client.host)

    # 规则：每个 IP 每分钟最多 30 次
    ip_rl = fixed_window_limit(f"ip:{client_ip}", limit=30, window_seconds=60)
    if not ip_rl.allowed:
        # 429 + Retry-After：前端可以据此提示用户等多久
        return JSONResponse(
            status_code=429,
            content={"error": {"code": "RATE_LIMITED", "message": "Too many requests"}},
            headers={
                "Retry-After": str(ip_rl.reset_seconds),
                "X-RateLimit-Limit": str(ip_rl.limit),
                "X-RateLimit-Remaining": str(ip_rl.remaining),
            },
        )

    # 如果有 session_id，再对 session 做一层更严格的限制
    if payload.session_id:
        s_rl = fixed_window_limit(f"session:{payload.session_id}", limit=15, window_seconds=60)
        if not s_rl.allowed:
            return JSONResponse(
            status_code=429,
            content={"error": {"code": "RATE_LIMITED", "message": "Too many requests"}},
            headers={
                "Retry-After": str(ip_rl.reset_seconds),
                "X-RateLimit-Limit": str(ip_rl.limit),
                "X-RateLimit-Remaining": str(ip_rl.remaining),
            },
        )
   # 1) session：后端权威
    if payload.session_id:
        s = db.get(ChatSession, payload.session_id)
        if not s:
            raise HTTPException(status_code=404, detail="Session not found")
    else:
        s = ChatSession()
        db.add(s)
        db.commit()
        db.refresh(s)

    # 2) 写入 user 消息
    user_msg = ChatMessage(session_id=s.id, role="user", content=payload.message)
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    # 3) 取上下文（最近 N 条，后面接真实模型也这么做）
    N = 20
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.session_id == s.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(N)
    )

    rows = db.execute(stmt).scalars().all()
    rows.reverse()
    history = rows

    llm_messages = [{"role": m.role, "content": m.content} for m in history]

    # 4) 调用 provider（目前 fake）
    result = provider.chat(llm_messages)

    # 5) 写入 assistant 消息
    assistant_msg = ChatMessage(session_id=s.id, role="assistant", content=result.text)
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)

    # 6) 写入 usage（关键：把 message_id 关联起来）
    usage = LLMUsage(
        session_id=s.id,
        message_id=assistant_msg.id,
        provider=result.provider,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
    )
    db.add(usage)
    db.commit()

    return {
        "session_id": s.id,
        "reply": result.text,
        "usage": {
            "provider": result.provider,
            "model": result.model,
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
            "total_tokens": result.total_tokens,
        },
    }

@app.get("/api/sessions/{session_id}/usage")
def get_usage(session_id: str, db: Session = Depends(get_db)):
    stmt = (
        select(LLMUsage)
        .where(LLMUsage.session_id == session_id)
        .order_by(LLMUsage.created_at.asc())
    )
    rows = db.execute(stmt).scalars().all()
    return {
        "session_id": session_id,
        "usage": [
            {
                "message_id": u.message_id,
                "provider": u.provider,
                "model": u.model,
                "prompt_tokens": u.prompt_tokens,
                "completion_tokens": u.completion_tokens,
                "total_tokens": u.total_tokens,
                "created_at": u.created_at.isoformat(),
            }
            for u in rows
        ],
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

