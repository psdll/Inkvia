"""探索 'The model is empty' 错误的真实含义。

可能性:
  - body 缺 'model' 字段(kie.ai 要求 body 里也写 model 即使 URL 已有)
  - body 缺 'messages' 字段
  - 需要别的字段
"""

from __future__ import annotations
import json
import os
import time
import urllib.request
import urllib.error
from pathlib import Path

for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
    os.environ.pop(k, None)
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env.local"
KEY = None
for line in ENV.read_text(encoding="utf-8").splitlines():
    if line.strip().startswith("KIE_LLM_API_KEY="):
        KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
        break


def post(url, body, timeout=40):
    req = urllib.request.Request(
        url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, (e.read().decode("utf-8", errors="replace") if e.fp else "")
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


def test(label, model, body):
    url = f"https://api.kie.ai/{model}/v1/chat/completions"
    s, b = post(url, body)
    print(f"\n[{label}] model={model}")
    print(f"  body: {json.dumps(body, ensure_ascii=False)[:160]}")
    print(f"  status={s}  resp={b[:300]}")
    time.sleep(2.0)  # 避免 429


def main():
    print("=" * 80)
    print("假设 1: 'The model is empty' 是因为 body 里没有 'model' 字段")
    print("=" * 80)
    # 在 body 里加 model 字段
    test("A1", "claude-opus-4-5",
         {"model": "claude-opus-4-5",
          "messages": [{"role": "user", "content": "Say OK"}], "max_tokens": 8})

    test("A2", "claude-sonnet-4-5",
         {"model": "claude-sonnet-4-5",
          "messages": [{"role": "user", "content": "Say OK"}], "max_tokens": 8})

    print("\n" + "=" * 80)
    print("假设 2: 用 OpenRouter 风格 model 名(provider/model)")
    print("=" * 80)
    test("B1", "claude-opus-4-5",
         {"model": "anthropic/claude-opus-4-5",
          "messages": [{"role": "user", "content": "Say OK"}], "max_tokens": 8})

    print("\n" + "=" * 80)
    print("假设 3: 测试已知 OK 的 gemini-3.1-pro 不加 model 字段(对照)")
    print("=" * 80)
    test("C1", "gemini-3.1-pro",
         {"messages": [{"role": "user", "content": "Say OK"}], "max_tokens": 8})

    print("\n" + "=" * 80)
    print("假设 4: 测试 gemini-3.1-pro 加 model 字段(对照)")
    print("=" * 80)
    test("C2", "gemini-3.1-pro",
         {"model": "gemini-3.1-pro",
          "messages": [{"role": "user", "content": "Say OK"}], "max_tokens": 8})


if __name__ == "__main__":
    main()
