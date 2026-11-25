"""慢速串行扫描(避开 kie.ai 20 reqs/10s 限速)。

只测 GPT 系列与几个剩余 gemini 变体。每个间隔 5s。
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
    # GPT 系列
    "gpt-5", "gpt-5-mini", "gpt-5-nano",
    "gpt-5-5", "gpt-5.5", "gpt-5-5-chat", "gpt-5.5-chat",
    "gpt-5-5-chat-openai-resp", "gpt-5-5-openai-resp",
    "gpt-4o", "gpt-4o-mini", "gpt-4.1", "chatgpt-4o-latest",
    "o1", "o3", "o3-mini", "o4-mini",
    # gemini 剩余
    "gemini-2.5-pro", "gemini-2.0-flash",
    "gemini-3.1-flash", "gemini-3-pro", "gemini-3.1-pro-openai",
    "gemini-3.1-pro-preview",  # 实际后端别名
]


def probe(model: str):
    url = f"https://api.kie.ai/{model}/v1/chat/completions"
    body = json.dumps({
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 4, "temperature": 0,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "User-Agent": UA,
    }, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=40)
        raw = r.read().decode("utf-8", errors="replace")
        try:
            j = json.loads(raw)
        except Exception:
            return "?", raw[:80]
        if "choices" in j and j["choices"]:
            content = (j["choices"][0].get("message", {}) or {}).get("content", "") or ""
            real_model = j.get("model", "?")
            return "✓", f"real_model={real_model}  content={content[:30]!r}"
        if j.get("code") == 422 and "not supported" in str(j.get("msg", "")).lower():
            return "✗", "not supported"
        if j.get("code") == 429:
            return "429", "rate limited"
        return "?", json.dumps(j, ensure_ascii=False)[:120]
    except urllib.error.HTTPError as e:
        return f"H{e.code}", (e.read().decode("utf-8", errors="replace") if e.fp else "")[:80]
    except Exception as e:
        return "ERR", f"{type(e).__name__}: {str(e)[:50]}"


def main():
    print(f"慢速串行扫描 {len(CANDIDATES)} 个候选(每个间隔 5s,避免 429)...\n")
    print(f"{'状态':<6} {'模型':<35} 说明")
    print("-" * 100)
    for i, m in enumerate(CANDIDATES):
        status, detail = probe(m)
        print(f"{status:<6} {m:<35} {detail}")
        if i < len(CANDIDATES) - 1:
            time.sleep(5.0)


if __name__ == "__main__":
    main()
