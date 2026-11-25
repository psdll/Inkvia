"""快速扫描 kie.ai 支持的 claude/gpt/gemini 模型名变体。

对每个候选 model 发一次最便宜的 chat.completions ping,根据返回判定:
  - {"code":422,"msg":"The model is not supported"} → 模型不存在
  - {"choices":[...]} → 支持
  - 其他 → 详查
"""

from __future__ import annotations
import json
import os
import urllib.request
import urllib.error
import concurrent.futures
from pathlib import Path

for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
    os.environ.pop(k, None)
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env.local"

def load_key():
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("KIE_LLM_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("KIE_LLM_API_KEY not found")


CANDIDATES = [
    # === 用户原始指定 ===
    "claude-opus-4-7",
    "gpt-5-5-openai-resp",
    "gemini-3.1-pro",   # 已知 OK
    # === Anthropic Claude 常见变体 ===
    "claude-opus-4",
    "claude-opus-4.1",
    "claude-opus-4-1",
    "claude-opus-4-5",
    "claude-opus-4.7",
    "claude-3-7-sonnet",
    "claude-3-5-sonnet",
    "claude-3-5-sonnet-20241022",
    "claude-sonnet-4",
    "claude-sonnet-4-5",
    "claude-sonnet-4-7",
    "claude-3-opus",
    "anthropic/claude-opus-4-7",
    # === OpenAI GPT 常见变体 ===
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4-1",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5-5",
    "gpt-5.5",
    "gpt-5.5-openai-resp",
    "gpt-5-5-chat-openai-resp",
    "gpt-5-5-chat",
    "chatgpt-4o-latest",
    "o1",
    "o3",
    "o3-mini",
    "o4-mini",
    "openai/gpt-5-5",
    # === Gemini 变体 ===
    "gemini-2.0-flash",
    "gemini-2.5-pro",
    "gemini-3-pro",
    "gemini-3.1-flash",
    "gemini-3.1-pro-openai",
]


def probe_model(model: str, key: str):
    url = f"https://api.kie.ai/{model}/v1/chat/completions"
    body = json.dumps({
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 4,
        "temperature": 0,
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": UA,
        },
        method="POST",
    )
    try:
        r = urllib.request.urlopen(req, timeout=30)
        raw = r.read().decode("utf-8", errors="replace")
        try:
            j = json.loads(raw)
        except Exception:
            return model, "?", raw[:80]
        if isinstance(j, dict):
            if "choices" in j and j["choices"]:
                content = (j["choices"][0].get("message", {}) or {}).get("content", "") or ""
                return model, "✓", f"content={content[:30]!r}"
            if j.get("code") == 422 and "not supported" in str(j.get("msg", "")).lower():
                return model, "✗", "not supported"
            return model, "?", json.dumps(j, ensure_ascii=False)[:100]
        return model, "?", str(j)[:100]
    except urllib.error.HTTPError as e:
        body_text = (e.read().decode("utf-8", errors="replace") if e.fp else "")[:100]
        return model, f"HTTP{e.code}", body_text
    except Exception as e:
        return model, "ERR", f"{type(e).__name__}: {str(e)[:60]}"


def main():
    key = load_key()
    print(f"扫描 {len(CANDIDATES)} 个候选模型(并发 6,timeout 30s 每个):\n")
    print(f"{'状态':<8} {'模型':<40} 说明")
    print("-" * 100)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(probe_model, m, key): m for m in CANDIDATES}
        for fut in concurrent.futures.as_completed(futures):
            model, status, detail = fut.result()
            print(f"{status:<8} {model:<40} {detail}")


if __name__ == "__main__":
    main()
