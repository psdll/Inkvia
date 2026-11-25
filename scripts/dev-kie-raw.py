"""查看 claude-opus-4-7 / gpt-5-5-openai-resp 的原始返回结构。

探针报告显示这两个模型 200 OK 但 choices[0].message.content 为空,
强烈暗示是 kie.ai 异步任务模型(返回 taskId,需轮询结果)。
本脚本直接打印完整原始响应 + 测试流式 406 的真实原因。
"""

from __future__ import annotations
import json
import os
import urllib.request
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


def post(url, body, key, accept="application/json", timeout=60):
    req = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": accept,
            "User-Agent": UA,
        },
        method="POST",
    )
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace") if e.fp else ""
        return e.code, body_text
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


def main():
    key = load_key()
    models = ["claude-opus-4-7", "gpt-5-5-openai-resp"]
    for m in models:
        print(f"\n{'=' * 70}\n{m}\n{'=' * 70}")
        # A) 非流式原始返回
        url = f"https://api.kie.ai/{m}/v1/chat/completions"
        status, body = post(url, {
            "messages": [{"role": "user", "content": "Say exactly: OK"}],
            "max_tokens": 8,
            "temperature": 0,
        }, key)
        print(f"\n[A] 非流式 POST {url}")
        print(f"    status={status}")
        print(f"    raw body (first 600 chars):")
        print(f"    {body[:600]}")
        # 尝试解析 JSON 并漂亮打印 keys
        try:
            j = json.loads(body)
            print(f"    parsed keys: {list(j.keys())}")
            if "choices" in j:
                msg = j["choices"][0].get("message", {})
                print(f"    choices[0].message keys: {list(msg.keys())}")
                print(f"    choices[0].message.content (repr): {repr(msg.get('content'))}")
            for special in ("taskId", "task_id", "data", "id", "status", "code", "msg"):
                if special in j:
                    print(f"    {special}: {j[special]!r}")
        except Exception as ex:
            print(f"    JSON parse failed: {ex}")

        # B) 流式请求,406 真因
        status, body = post(url, {
            "messages": [{"role": "user", "content": "Say: 1 2 3"}],
            "max_tokens": 16,
            "stream": True,
        }, key, accept="text/event-stream")
        print(f"\n[B] 流式 stream=true, Accept=text/event-stream")
        print(f"    status={status}")
        print(f"    raw body (first 600 chars):")
        print(f"    {body[:600]}")

        # C) 不带 Accept header 的流式
        status, body = post(url, {
            "messages": [{"role": "user", "content": "Say: 1 2 3"}],
            "max_tokens": 16,
            "stream": True,
        }, key, accept="application/json")
        print(f"\n[C] 流式 stream=true, Accept=application/json")
        print(f"    status={status}")
        print(f"    raw body (first 600 chars):")
        print(f"    {body[:600]}")


if __name__ == "__main__":
    main()
