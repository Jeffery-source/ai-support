import os
import time
import redis
from dataclasses import dataclass

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
r = redis.Redis.from_url(REDIS_URL, decode_responses=True)

@dataclass
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_seconds: int  # 还要多久窗口重置

def fixed_window_limit(key: str, limit: int, window_seconds: int) -> RateLimitResult:
    """
    固定窗口限流：
    - 以 window_seconds 为周期计数
    - Redis: INCR + EXPIRE
    """
    now = int(time.time())
    # 用时间片做窗口：同一个窗口内 key 相同
    window_id = now // window_seconds
    redis_key = f"rl:{key}:{window_id}"

    count = r.incr(redis_key)
    if count == 1:
        # 第一次命中，设置过期时间，让窗口结束自动清空
        r.expire(redis_key, window_seconds)

    ttl = r.ttl(redis_key)
    # ttl 可能为 -1 / -2，做个兜底
    reset_seconds = ttl if ttl and ttl > 0 else window_seconds

    allowed = count <= limit
    remaining = max(0, limit - count)

    return RateLimitResult(
        allowed=allowed,
        limit=limit,
        remaining=remaining,
        reset_seconds=reset_seconds
    )
