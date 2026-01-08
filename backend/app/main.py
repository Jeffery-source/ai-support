from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="AI Support Backend")

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





class ChatIn(BaseModel):
    message: str


@app.get("/health")
def health():
    return {"ok": True}

@app.post("/api/chat")
def chat(payload: ChatIn):
    # 先做 mock：后面再换成真实 LLM
    return {"reply": f"（mock）我收到了：{payload.message}"}