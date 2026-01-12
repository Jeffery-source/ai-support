from dataclasses import dataclass



@dataclass
class LLMResult:
    text: str
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int

class FakeProvider:
    def __init__(self, model: str = "fake-1"):
        self.model = model

    def chat(self, messages: list[dict]) -> LLMResult:
        # 超简 token 估算：按字符数粗略除 4（只是为了打通链路）
        prompt_chars = sum(len(m.get("content", "")) for m in messages)
        prompt_tokens = max(1, prompt_chars // 4)

        user_text = messages[-1].get("content", "")
        reply = f"（fake）我收到了：{user_text}"

        completion_tokens = max(1, len(reply) // 4)
        total_tokens = prompt_tokens + completion_tokens

        return LLMResult(
            text=reply,
            provider="fake",
            model=self.model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )