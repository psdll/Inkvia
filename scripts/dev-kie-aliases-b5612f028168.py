"""测试 kie.ai 的 -completions 别名是否真能走 OpenAI chat.completions。

如果别名能用,可以避免实现 Anthropic 原生 + Responses API 两套协议。
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

CANDIDATES = [
    "claude-opus-4-5-completions",
    "claude-sonnet-4-5-completions",
    "gpt-5-5-chat-completions",
    # 对照:gemini-3.1-pro 已知 OK
    "gemini-3.1-pro",
]


def probe(model: str):
    url = f"https://api.kie.ai/{model}/v1/chat/completions"
    body = json.dumps({
        "messages": [{"role": "user", "content": "Say only: OK"}],
        "max_tokens": 8, "temperature": 0,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "User-Agent": UA,
    }, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=60)
        raw = r.read().decode("utf-8", errors="replace")
        return r.status, raw[:500]
    except urllib.error.HTTPError as e:
        return e.code, (e.read().decode("utf-8", errors="replace") if e.fp else "")[:300]
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


def main():
    print(f"测试 chat.completions 别名(每个间隔 5s)\n")
    for i, m in enumerate(CANDIDATES):
        s, b = probe(m)
        print(f"\n[{i+1}/{len(CANDIDATES)}] {m}")
        print(f"  status={s}")
        try:
            j = json.loads(b)
            if "choices" in j and j["choices"]:
                msg = j["choices"][0].get("message", {}) or {}
                content = msg.get("content", "")
                real_model = j.get("model", "?")
                print(f"  ✓ real_model={real_model}  content={content!r}")
            else:
                print(f"  ✗ {b[:300]}")
        except Exception:
            print(f"  raw: {b[:300]}")
        if i < len(CANDIDATES) - 1:
            time.sleep(5.0)


if __name__ == "__main__":
    main()
