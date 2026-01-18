from fastapi import Depends, FastAPI, HTTPException, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Optional

from .auth import hash_password, verify_password, create_access_token, decode_token
from .db import engine, SessionLocal
from .llm import FakeProvider
from .models import Base, ChatSession, ChatMessage, LLMUsage, User
from .rate_limit import fixed_window_limit

app = FastAPI(title="AI Support Backend")
provider = FakeProvider(model="fake-1")
Base.metadata.create_all(bind=engine)
bearer = HTTPBearer(auto_error=False)
ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
IP_RATE_LIMIT = {"limit": 30, "window_seconds": 60}
SESSION_RATE_LIMIT = {"limit": 15, "window_seconds": 60}
RECENT_MESSAGE_LIMIT = 20

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
    allow_origins=list(ALLOWED_ORIGINS),
    allow_credentials=True,
    # Allow all methods/headers for local dev.
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    # Provide a scoped session per request and always close it.
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def resolve_client_ip(request: Request) -> str:
    # Prefer X-Forwarded-For when present (first hop), else fall back to socket IP.
    xff = request.headers.get("x-forwarded-for")
    return xff.split(",")[0].strip() if xff else request.client.host

def get_current_user(
    cred: HTTPAuthorizationCredentials = Security(bearer),
    db: Session = Depends(get_db),
) -> User:
    # Decode bearer token and load the user record.
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

def rate_limit_response(limit_result):
    # Normalize rate limit responses with standard headers.
    return JSONResponse(
        status_code=429,
        content={"error": {"code": "RATE_LIMITED", "message": "Too many requests"}},
        headers={
            "Retry-After": str(limit_result.reset_seconds),
            "X-RateLimit-Limit": str(limit_result.limit),
            "X-RateLimit-Remaining": str(limit_result.remaining),
        },
    )

def apply_rate_limit(key: str, limit_config: dict):
    # Apply a fixed-window limit and return a response if blocked.
    result = fixed_window_limit(
        key,
        limit=limit_config["limit"],
        window_seconds=limit_config["window_seconds"],
    )
    if not result.allowed:
        return rate_limit_response(result)
    return None

@app.get("/api/chat/sessions")
def get_sessions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # List sessions owned by the current user, newest first.
    stmt = (
        select(ChatSession)
        .where(ChatSession.user_id == user.id)
        .order_by(ChatSession.created_at.desc())
    )
    sessions = db.execute(stmt).scalars().all()

    return [
        {
            "id": s.id,
            "title": getattr(s, "title", None) or s.created_at.strftime("%Y-%m-%d %H:%M"),
            "created_at": s.created_at,
        }
        for s in sessions
    ]

@app.get("/api/sessions/{session_id}/messages")
def get_messages(session_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Ensure session exists and belongs to the current user.
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
    # Create a new session for the current user.
    s = ChatSession(user_id=user.id)
    if hasattr(s, "title") and payload.title:
        s.title = payload.title

    db.add(s)
    db.commit()
    db.refresh(s)

    return {"id": s.id, "title": getattr(s, "title", None)}

@app.post("/api/chat/sessions/{session_id}/messages", response_model=ChatReplyOut)
def chat_in_session(
    session_id: str,
    payload: MessageCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Resolve client IP (respect X-Forwarded-For for proxies).
    client_ip = resolve_client_ip(request)

    # Apply per-IP and per-session rate limits.
    resp = apply_rate_limit(f"ip:{client_ip}", IP_RATE_LIMIT)
    if resp:
        return resp
    resp = apply_rate_limit(f"session:{session_id}", SESSION_RATE_LIMIT)
    if resp:
        return resp

    # Ensure session exists and belongs to the current user.
    s = db.get(ChatSession, session_id)
    if not s or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    # Persist user message before calling the LLM.
    user_msg = ChatMessage(session_id=s.id, role="user", content=payload.message)
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    # Load recent context (last N messages).
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.session_id == s.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(RECENT_MESSAGE_LIMIT)
    )
    rows = db.execute(stmt).scalars().all()
    rows.reverse()

    llm_messages = [{"role": m.role, "content": m.content} for m in rows]

    # Call provider to generate assistant reply.
    result = provider.chat(llm_messages)

    # Persist assistant message.
    assistant_msg = ChatMessage(session_id=s.id, role="assistant", content=result.text)
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)

    # Persist usage for metrics/billing.
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
    # Return usage records for a session.
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
    # Ensure CORS headers are set even on unhandled errors.
    resp = JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "Something went wrong."}},
    )
    # Set CORS headers for allowed origins.
    origin = request.headers.get("origin")
    if origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
    return resp

@app.post("/api/auth/signup")
def signup(payload: SignUpIn, db: Session = Depends(get_db)):
    # Register a new user if the email is not taken.
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
    # Verify credentials and return an access token.
    u = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if not u or not verify_password(payload.password, u.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(u.id)
    return {"access_token": token, "user": {"id": u.id, "email": u.email}}

