"""kie.ai 三个目标模型协议探针。

读取 .env.local 的 KIE_LLM_API_KEY,对 claude-opus-4-7 / gemini-3.1-pro /
gpt-5-5-openai-resp 三个模型分别探测:
  1. chat.completions 兼容性 (model-prefixed endpoint)
  2. 流式 SSE 事件结构
  3. JSON mode (response_format)
  4. vision (data URL 图像输入)
  5. 错误码与错误结构
  6. 若 chat.completions 失败,自动回退试 Responses API 协议

输出 markdown 报告,确定每个模型该用 chat.completions 还是 Responses API,
并给出实施 lib/llm/kie-provider.ts 时所需的协议参数。

运行:
  PYTHONIOENCODING=utf-8 python scripts/dev-kie-probe.py
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# kie.ai 在 cloudflare 上,本地 Clash/v2ray 代理常导致 TLS 握手失败。
# 这里强制绕过代理直连(api.kie.ai 国内可直连)。
for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
    os.environ.pop(k, None)
_PROXY_HANDLER = urllib.request.ProxyHandler({})
_OPENER = urllib.request.build_opener(_PROXY_HANDLER)
urllib.request.install_opener(_OPENER)

REPO = Path(__file__).resolve().parent.parent
ENV_LOCAL = REPO / ".env.local"

BASE_URL = os.environ.get("KIE_LLM_BASE_URL", "https://api.kie.ai").rstrip("/")
MODELS = [
    "claude-opus-4-7",
    "gemini-3.1-pro",
    "gpt-5-5-openai-resp",
]

# 1x1 transparent PNG, base64
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+M8AAAICAQHk6NM/AAAAAElFTkSuQmCC"
)


def load_api_key() -> str:
    env = os.environ.get("KIE_LLM_API_KEY", "").strip()
    if env:
        return env
    if ENV_LOCAL.exists():
        for line in ENV_LOCAL.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("KIE_LLM_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    print("ERROR: 找不到 KIE_LLM_API_KEY (env 或 .env.local)", file=sys.stderr)
    sys.exit(2)


def request(method: str, url: str, body: dict | None, api_key: str, *, stream: bool, timeout: int = 45):
    # Cloudflare 在 Python urllib 默认 UA 上返回 1010。给一个真实浏览器 UA。
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if stream else "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    t0 = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        if stream:
            return {"ok": True, "status": resp.status, "stream": resp, "ms": int((time.time() - t0) * 1000)}
        raw = resp.read().decode("utf-8", errors="replace")
        return {"ok": True, "status": resp.status, "body": raw, "ms": int((time.time() - t0) * 1000)}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        return {"ok": False, "status": e.code, "body": raw, "ms": int((time.time() - t0) * 1000)}
    except Exception as e:
        return {"ok": False, "status": 0, "body": f"{type(e).__name__}: {e}", "ms": int((time.time() - t0) * 1000)}


def short(s: str, n: int = 240) -> str:
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[:n] + "..."


def parse_first_choice_content(raw: str) -> str:
    try:
        j = json.loads(raw)
        return str(j.get("choices", [{}])[0].get("message", {}).get("content", ""))
    except Exception:
        return ""


def probe_chat_completions(model: str, api_key: str):
    """Test model-prefixed chat.completions endpoint."""
    url = f"{BASE_URL}/{model}/v1/chat/completions"
    body = {
        "messages": [{"role": "user", "content": "Say only the word: OK"}],
        "max_tokens": 8,
        "temperature": 0,
    }
    r = request("POST", url, body, api_key, stream=False)
    summary = {
        "endpoint": url,
        "status": r["status"],
        "ms": r["ms"],
        "ok": r["ok"],
        "preview": short(r.get("body", "")),
    }
    if r["ok"]:
        content = parse_first_choice_content(r["body"])
        summary["content"] = short(content, 80)
    return summary


def probe_unified_chat_completions(model: str, api_key: str):
    """Fallback: test unified /v1/chat/completions with model in body."""
    url = f"{BASE_URL}/v1/chat/completions"
    body = {
        "model": model,
        "messages": [{"role": "user", "content": "Say only the word: OK"}],
        "max_tokens": 8,
        "temperature": 0,
    }
    r = request("POST", url, body, api_key, stream=False)
    return {
        "endpoint": url,
        "status": r["status"],
        "ms": r["ms"],
        "ok": r["ok"],
        "preview": short(r.get("body", "")),
    }


def probe_responses_api(model: str, api_key: str):
    """Test OpenAI Responses API protocol."""
    for url in [f"{BASE_URL}/{model}/v1/responses", f"{BASE_URL}/v1/responses"]:
        body = {
            "model": model,
            "input": "Say only the word: OK",
            "max_output_tokens": 16,
        }
        r = request("POST", url, body, api_key, stream=False)
        if r["status"] not in (0, 404):
            return {
                "endpoint": url,
                "status": r["status"],
                "ms": r["ms"],
                "ok": r["ok"],
                "preview": short(r.get("body", "")),
            }
    return {"endpoint": "(both 404)", "status": 404, "ms": 0, "ok": False, "preview": ""}


def probe_stream(model: str, api_key: str):
    """Test streaming with chat.completions SSE."""
    url = f"{BASE_URL}/{model}/v1/chat/completions"
    body = {
        "messages": [{"role": "user", "content": "Count: 1 2 3"}],
        "max_tokens": 16,
        "stream": True,
    }
    r = request("POST", url, body, api_key, stream=True)
    if not r["ok"]:
        return {"endpoint": url, "ok": False, "status": r["status"], "preview": short(r.get("body", ""))}

    events_seen: list[str] = []
    first_byte_ms = None
    t_start = time.time()
    raw_lines: list[str] = []
    try:
        for chunk in r["stream"]:
            if first_byte_ms is None:
                first_byte_ms = int((time.time() - t_start) * 1000)
            text = chunk.decode("utf-8", errors="replace") if isinstance(chunk, bytes) else str(chunk)
            for line in text.splitlines():
                if not line:
                    continue
                raw_lines.append(line)
                if line.startswith("event:"):
                    events_seen.append(line[6:].strip())
                elif line.startswith("data:"):
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        events_seen.append("[DONE]")
                        continue
                    try:
                        j = json.loads(raw)
                        # OpenAI chat.completion.chunk has 'object' field
                        obj = j.get("object")
                        if obj:
                            events_seen.append(f"object={obj}")
                        # Responses API has 'type' field
                        typ = j.get("type")
                        if typ:
                            events_seen.append(f"type={typ}")
                    except Exception:
                        pass
            if len(raw_lines) > 30:
                break
    finally:
        try:
            r["stream"].close()
        except Exception:
            pass

    return {
        "endpoint": url,
        "ok": True,
        "first_byte_ms": first_byte_ms,
        "events": list(dict.fromkeys(events_seen))[:10],
        "lines": raw_lines[:6],
    }


def probe_json_mode(model: str, api_key: str):
    url = f"{BASE_URL}/{model}/v1/chat/completions"
    body = {
        "messages": [
            {
                "role": "user",
                "content": 'Return JSON {"answer":"hello"} and nothing else.',
            }
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 50,
        "temperature": 0,
    }
    r = request("POST", url, body, api_key, stream=False)
    if not r["ok"]:
        return {"ok": False, "status": r["status"], "preview": short(r.get("body", ""))}
    content = parse_first_choice_content(r["body"])
    try:
        json.loads(content)
        valid_json = True
    except Exception:
        valid_json = False
    return {"ok": True, "status": r["status"], "valid_json": valid_json, "content": short(content, 120)}


def probe_vision(model: str, api_key: str):
    url = f"{BASE_URL}/{model}/v1/chat/completions"
    data_url = f"data:image/png;base64,{TINY_PNG_B64}"
    body = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Briefly describe this image."},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        "max_tokens": 30,
    }
    r = request("POST", url, body, api_key, stream=False)
    if not r["ok"]:
        return {"ok": False, "status": r["status"], "preview": short(r.get("body", ""))}
    content = parse_first_choice_content(r["body"])
    return {"ok": True, "status": r["status"], "content": short(content, 120)}


def main():
    api_key = load_api_key()
    print(f"# kie.ai 协议探针报告")
    print(f"\nBase URL: `{BASE_URL}`")
    print(f"Key 前 6 位: `{api_key[:6]}...`  长度: {len(api_key)}\n")

    for model in MODELS:
        print(f"\n## {model}\n")

        # 1) chat.completions (model-prefixed)
        cc = probe_chat_completions(model, api_key)
        print(f"### 1) chat.completions (model-prefixed)")
        print(f"- endpoint: `{cc['endpoint']}`")
        print(f"- status: **{cc['status']}**  耗时 {cc['ms']}ms")
        if cc["ok"]:
            print(f"- content: `{cc.get('content', '')}`")
            print(f"- 判定: ✓ 兼容 chat.completions(model-prefixed endpoint)")
        else:
            print(f"- body: `{cc['preview']}`")
            # 2) unified fallback
            uc = probe_unified_chat_completions(model, api_key)
            print(f"\n### 2) chat.completions (unified /v1/chat/completions)")
            print(f"- endpoint: `{uc['endpoint']}`")
            print(f"- status: **{uc['status']}**  耗时 {uc['ms']}ms")
            print(f"- body: `{uc['preview']}`")
            if not uc["ok"]:
                # 3) Responses API fallback
                rp = probe_responses_api(model, api_key)
                print(f"\n### 3) Responses API")
                print(f"- endpoint: `{rp['endpoint']}`")
                print(f"- status: **{rp['status']}**  耗时 {rp['ms']}ms")
                print(f"- body: `{rp['preview']}`")
                if rp["ok"]:
                    print(f"- 判定: 需要 Responses API 适配层")
                else:
                    print(f"- 判定: ✗ 三种协议都失败,模型可能不存在或 key 无权限")
            continue  # skip stream/json/vision since chat.completions 不通

        # 3) stream
        st = probe_stream(model, api_key)
        print(f"\n### 流式 SSE")
        if st["ok"]:
            print(f"- 首字节 {st['first_byte_ms']}ms")
            print(f"- 事件类型(去重): {st['events']}")
            print(f"- 原始前 6 行:")
            for ln in st["lines"]:
                print(f"  - `{short(ln, 120)}`")
        else:
            print(f"- ✗ 失败 status={st['status']} body=`{st.get('preview', '')}`")

        # 4) json mode
        jm = probe_json_mode(model, api_key)
        print(f"\n### JSON mode (response_format)")
        if jm["ok"]:
            print(f"- valid_json: **{jm['valid_json']}**  content: `{jm['content']}`")
        else:
            print(f"- ✗ status={jm['status']} body=`{jm.get('preview', '')}`")

        # 5) vision
        vs = probe_vision(model, api_key)
        print(f"\n### Vision (data URL)")
        if vs["ok"]:
            print(f"- ✓ status {vs['status']}, content: `{vs['content']}`")
        else:
            print(f"- ✗ status={vs['status']} body=`{vs.get('preview', '')}`")

    print("\n---\n## 实施结论汇总")
    print("根据上面每个模型的判定行,实施 lib/llm/kie-provider.ts 时:")
    print("- 默认协议:chat.completions (model-prefixed)")
    print("- 若任一模型判定为 Responses API,需要 KieResponsesProvider 分支")
    print("- OCR 视觉只能用支持 vision 判定为 ✓ 的模型")
    print("- JSON mode 不支持的模型,记忆/摘要场景需用 prompt 强制 JSON + 容错解析")


if __name__ == "__main__":
    main()
