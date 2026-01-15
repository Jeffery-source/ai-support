from fastapi import FastAPI,Request,HTTPException,Depends,Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import uuid
from sqlalchemy.orm import Session
from .db import engine, SessionLocal
from .models import Base, ChatSession, ChatMessage,LLMUsage,User
from sqlalchemy import select
from .llm import FakeProvider
from .rate_limit import fixed_window_limit
from pydantic import BaseModel, EmailStr
from .auth import hash_password, verify_password, create_access_token, decode_token
from typing import Optional

app = FastAPI(title="AI Support Backend")
provider = FakeProvider(model="fake-1")
Base.metadata.create_all(bind=engine)
bearer = HTTPBearer(auto_error=False)

class SignUpIn(BaseModel):
    email: EmailStr
    password: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class SessionCreateIn(BaseModel):
    title: Optional[str] = None

class SessionOut(BaseModel):
    id: str
    title: Optional[str] = None

class MessageCreateIn(BaseModel):
    message: str

class ChatReplyOut(BaseModel):
    session_id: str
    reply: str
    usage: dict

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

def get_current_user(
    cred: HTTPAuthorizationCredentials = Security(bearer),
    db: Session = Depends(get_db),
) -> User:
    if cred is None:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        user_id = decode_token(cred.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/api/chat/sessions")
def get_sessions(db:Session=Depends(get_db), user: User = Depends(get_current_user)):
    stmt=(
        select(ChatSession)
        .where(ChatSession.user_id==user.id)
        .order_by(ChatSession.created_at.desc())
    )
    sessions=db.execute(stmt).scalars().all()

    return [
        {
            "id": s.id,
            "title": s.id or s.created_at.strftime("%Y-%m-%d %H:%M"),
            "created_at": s.created_at,
        }
        for s in sessions
    ]

@app.get("/api/sessions/{session_id}/messages")
def get_messages(session_id: str, db: Session = Depends(get_db),user: User = Depends(get_current_user)):
    s = db.get(ChatSession, session_id)
    if s is None or s.user_id != user.id:
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

@app.post("/api/chat/sessions", response_model=SessionOut)
def create_session(
    payload: SessionCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    s = ChatSession(user_id=user.id)
    if hasattr(s, "title") and payload.title:
        s.title = payload.title

    db.add(s)
    db.commit()
    db.refresh(s)

    return {"id": s.id, "title": getattr(s, "title", None)}

@app.post("/api/chat/sessions/{session_id}/messages", response_model=ChatReplyOut)
def chat_in_session(
    session_id: str ,
    payload: MessageCreateIn = None,
    request: Request = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # 取客户端 IP（优先 X-Forwarded-For）
    xff = request.headers.get("x-forwarded-for")
    client_ip = (xff.split(",")[0].strip() if xff else request.client.host)

    # IP 限流：每个 IP 每分钟最多 30 次
    ip_rl = fixed_window_limit(f"ip:{client_ip}", limit=30, window_seconds=60)
    if not ip_rl.allowed:
        return JSONResponse(
            status_code=429,
            content={"error": {"code": "RATE_LIMITED", "message": "Too many requests"}},
            headers={
                "Retry-After": str(ip_rl.reset_seconds),
                "X-RateLimit-Limit": str(ip_rl.limit),
                "X-RateLimit-Remaining": str(ip_rl.remaining),
            },
        )

    # session 限流：每个 session 每分钟最多 15 次
    s_rl = fixed_window_limit(f"session:{session_id}", limit=15, window_seconds=60)
    if not s_rl.allowed:
        return JSONResponse(
            status_code=429,
            content={"error": {"code": "RATE_LIMITED", "message": "Too many requests"}},
            headers={
                "Retry-After": str(s_rl.reset_seconds),
                "X-RateLimit-Limit": str(s_rl.limit),
                "X-RateLimit-Remaining": str(s_rl.remaining),
            },
        )

    # 1) session 必须存在且属于当前用户
    s = db.get(ChatSession, session_id)
    if not s or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    # 2) 写入 user 消息
    user_msg = ChatMessage(session_id=s.id, role="user", content=payload.message)
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    # 3) 取上下文（最近 N 条）
    N = 20
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.session_id == s.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(N)
    )
    rows = db.execute(stmt).scalars().all()
    rows.reverse()

    llm_messages = [{"role": m.role, "content": m.content} for m in rows]

    # 4) 调用 provider
    result = provider.chat(llm_messages)

    # 5) 写入 assistant 消息
    assistant_msg = ChatMessage(session_id=s.id, role="assistant", content=result.text)
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)

    # 6) 写入 usage
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

@app.post("/api/auth/signup")
def signup(payload: SignUpIn, db: Session = Depends(get_db)):
    exists = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Email already registered")

    u = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(u)
    db.commit()
    db.refresh(u)

    token = create_access_token(u.id)
    return {"access_token": token, "user": {"id": u.id, "email": u.email}}

@app.post("/api/auth/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    u = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if not u or not verify_password(payload.password, u.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(u.id)
    return {"access_token": token, "user": {"id": u.id, "email": u.email}}