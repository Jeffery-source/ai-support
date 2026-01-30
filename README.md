# AI-Support (MVP)

AI-Support is a minimal full-stack customer support chat app with persistent sessions, user authentication, and production-style backend patterns (DB persistence, rate limiting, usage tracking).  
It currently uses a mock LLM provider and is designed to swap in a real LLM provider later.

## Features

- **Auth**: Email/password signup & login (JWT Bearer token)
- **Chat sessions**: Session-based conversations with persisted message history (PostgreSQL)
- **History restore**: Frontend loads history on refresh using cached `session_id`
- **LLM provider abstraction**: Pluggable provider interface (currently `FakeProvider`)
- **Usage tracking**: Persists per-response token usage (`LLMUsage` table)
- **Rate limiting**: Redis-based fixed-window rate limit to prevent abusive requests
- **Error handling**: API error responses with clear messages (frontend displays failures)

## Tech Stack

### Frontend

- **React** (UI)
- **Vite** (dev server & build tooling)
- **Fetch API** (API calls)
- **LocalStorage** (stores `access_token` and `session_id`)

### Backend

- **FastAPI** (Python web framework)
- **SQLAlchemy ORM** (database mapping & queries)
- **PostgreSQL** (persistent storage)
- **Redis** (rate limiting, and optionally token revocation/blacklist)
- **JWT (python-jose)** + **bcrypt (passlib)** (authentication)

## Project Structure

ai-support/
frontend/ # React + Vite app
backend/ # FastAPI app
infra/ # docker-compose for Postgres/Redis (optional)

## Getting Started

### Prerequisites

- Node.js (18+ recommended)
- Python (3.10+ recommended)
- Docker (optional, for Postgres/Redis)

---

## 1) Start Postgres + Redis (Docker)

From `infra/`:

```bash
docker compose up -d
Expected services:

Postgres on localhost:5432

Redis on localhost:6379

If you already have Postgres/Redis running locally, you can skip Docker and update backend env variables.

2) Backend Setup
From backend/:

python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
Create .env in backend/:

DATABASE_URL=postgresql+psycopg://app:app@127.0.0.1:5432/aisupport
REDIS_URL=redis://127.0.0.1:6379/0

JWT_SECRET=change-me-to-a-long-random-string
JWT_EXPIRE_MIN=43200
Run the API:

uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
Backend is now running at:

http://127.0.0.1:8000

3) Frontend Setup
From frontend/:

npm install
npm run dev
Frontend is now running at:

http://localhost:5173

API Overview
Auth
POST /api/auth/signup

POST /api/auth/login

Example request body:

{
  "email": "test@example.com",
  "password": "12345678"
}
Chat
POST /api/chat (requires Authorization: Bearer <token>)

GET /api/sessions/{session_id}/messages (requires Authorization: Bearer <token>)
```
