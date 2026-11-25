"""探测 kie.ai Responses API 的实际请求/响应/流式格式。

只对 gpt-5-5 走 /codex/v1/responses,把以下信息抠出来:
  - 非流式响应结构(output 字段路径、文本提取位置)
  - 流式 SSE 完整事件序列(event 名 + data 形状)
  - 错误/limit 行为
"""
from __future__ import annotations
import json
import os
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

URL = "https://api.kie.ai/codex/v1/responses"


def post(body, stream=False, timeout=90):
    headers = {
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
        "User-Agent": UA,
        "Accept": "text/event-stream" if stream else "application/json",
    }
    req = urllib.request.Request(
        URL, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers=headers, method="POST",
    )
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        if stream:
            return r.status, r
        return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, (e.read().decode("utf-8", errors="replace") if e.fp else "")
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


def main():
    # === A. 非流式 ===
    print("=" * 70 + "\n[A] 非流式: input as messages array\n" + "=" * 70)
    s, b = post({
        "model": "gpt-5-5",
        "input": [{"role": "user", "content": "Reply with just: OK"}],
        "max_output_tokens": 16,
    })
    print(f"status={s}")
    print(f"raw (first 1500):\n{b[:1500]}\n")
    try:
        j = json.loads(b)
        print(f"top-level keys: {list(j.keys())}")
        # 探多种可能的文本字段位置
        if "output" in j:
            print(f"output type: {type(j['output']).__name__}")
            if isinstance(j["output"], list) and j["output"]:
                print(f"output[0] keys: {list(j['output'][0].keys()) if isinstance(j['output'][0], dict) else '?'}")
                content = j["output"][0].get("content") if isinstance(j["output"][0], dict) else None
                if isinstance(content, list) and content:
                    print(f"output[0].content[0]: {content[0]}")
        if "output_text" in j:
            print(f"output_text (shortcut): {j['output_text']!r}")
    except Exception as ex:
        print(f"JSON parse fail: {ex}")

    # === B. 流式 ===
    print("\n" + "=" * 70 + "\n[B] 流式: stream=true\n" + "=" * 70)
    s, r = post({
        "model": "gpt-5-5",
        "input": [{"role": "user", "content": "Say: 1 2 3"}],
        "max_output_tokens": 24,
        "stream": True,
    }, stream=True)
    print(f"status={s}")
    if s != 200:
        print(f"failed body: {r}")
        return

    # 解析 SSE
    decoder = lambda data: data.decode("utf-8", errors="replace") if isinstance(data, bytes) else str(data)
    buffer = ""
    event_summary = {}  # event name -> {count, first_data_keys}
    raw_first_events = []
    line_count = 0

    for chunk in r:
        text = decoder(chunk)
        buffer += text
        while "\n\n" in buffer:
            block, buffer = buffer.split("\n\n", 1)
            event_name = "message"
            data_lines = []
            for line in block.split("\n"):
                if line.startswith("event:"):
                    event_name = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].strip())
            data_raw = "\n".join(data_lines)
            if not data_raw:
                continue

            line_count += 1
            try:
                data_obj = json.loads(data_raw)
                inner_type = data_obj.get("type", "?") if isinstance(data_obj, dict) else "?"
                if event_name not in event_summary:
                    event_summary[event_name] = {
                        "count": 0,
                        "inner_types": set(),
                        "sample_keys": list(data_obj.keys())[:8] if isinstance(data_obj, dict) else [],
                    }
                event_summary[event_name]["count"] += 1
                event_summary[event_name]["inner_types"].add(inner_type)

                # 保留前 8 个事件的完整数据(精简到 200 字符)
                if line_count <= 8:
                    raw_first_events.append({
                        "event": event_name,
                        "data": str(data_obj)[:200]
                    })
            except Exception:
                pass

            # 跑够样本就停
            if line_count > 50:
                break
        if line_count > 50:
            break

    print(f"\n捕获 {line_count} 个 SSE data 行\n")
    print("== 事件类型汇总 ==")
    for ev, info in event_summary.items():
        print(f"  event={ev!r}  count={info['count']}  inner_types={info['inner_types']}  sample_keys={info['sample_keys']}")

    print("\n== 前 8 个事件的真实数据 ==")
    for i, ev in enumerate(raw_first_events):
        print(f"  [{i+1}] event={ev['event']!r}")
        print(f"      data={ev['data']}")

    # 关键判断:文本增量字段在哪个 event/字段里
    print("\n== 文本增量字段判定 ==")
    text_event = None
    for ev, info in event_summary.items():
        types_str = ",".join(info["inner_types"])
        if "delta" in types_str or "output_text" in ev or "delta" in ev:
            text_event = (ev, types_str)
    print(f"推测文本增量事件: {text_event}")


if __name__ == "__main__":
    main()
