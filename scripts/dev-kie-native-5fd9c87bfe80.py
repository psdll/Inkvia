"""用真实协议 ping claude/gpt,确认 kie.ai 是否真能跑用户指定的模型。

Claude → POST /claude/v1/messages (Anthropic 原生)
GPT    → POST /codex/v1/responses (OpenAI Responses API)
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


def post(url, body, timeout=60):
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


def main():
    # === Claude (Anthropic native) ===
    print("=" * 80)
    print("[1] Claude: POST /claude/v1/messages (Anthropic native)")
    print("=" * 80)
    s, b = post("https://api.kie.ai/claude/v1/messages", {
        "model": "claude-opus-4-7",
        "max_tokens": 16,
        "messages": [{"role": "user", "content": "Say only: OK"}],
    })
    print(f"status={s}")
    print(f"raw: {b[:600]}")
    try:
        j = json.loads(b)
        if "content" in j and isinstance(j["content"], list):
            text = "".join(blk.get("text", "") for blk in j["content"] if blk.get("type") == "text")
            print(f"✓ assistant text: {text!r}")
            print(f"  model: {j.get('model')}")
            print(f"  stop_reason: {j.get('stop_reason')}")
        elif j.get("code"):
            print(f"✗ business error: code={j.get('code')} msg={j.get('msg')}")
    except Exception as ex:
        print(f"parse error: {ex}")

    time.sleep(5)

    # === GPT (OpenAI Responses) ===
    print("\n" + "=" * 80)
    print("[2] GPT: POST /codex/v1/responses (OpenAI Responses API)")
    print("=" * 80)
    s, b = post("https://api.kie.ai/codex/v1/responses", {
        "model": "gpt-5-5",
        "input": "Say only: OK",
        "max_output_tokens": 16,
    })
    print(f"status={s}")
    print(f"raw: {b[:600]}")
    try:
        j = json.loads(b)
        # Responses API: output[0].content[0].text
        if "output" in j and j["output"]:
            blk = j["output"][0]
            content_list = blk.get("content", [])
            texts = [c.get("text", "") for c in content_list if c.get("type") == "output_text"]
            print(f"✓ output text: {''.join(texts)!r}")
            print(f"  model: {j.get('model')}")
            print(f"  status: {j.get('status')}")
        elif j.get("code"):
            print(f"✗ business error: code={j.get('code')} msg={j.get('msg')}")
    except Exception as ex:
        print(f"parse error: {ex}")

    time.sleep(5)

    # === GPT Responses with messages-style? ===
    print("\n" + "=" * 80)
    print("[3] 备用:测试 gpt-5-5 走 Responses 用 messages 格式")
    print("=" * 80)
    s, b = post("https://api.kie.ai/codex/v1/responses", {
        "model": "gpt-5-5",
        "input": [{"role": "user", "content": "Say only: OK"}],
        "max_output_tokens": 16,
    })
    print(f"status={s}")
    print(f"raw: {b[:600]}")


if __name__ == "__main__":
    main()
