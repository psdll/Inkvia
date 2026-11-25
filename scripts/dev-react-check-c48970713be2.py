"""验证 ReAct 工具调用链路。

3 个场景:
  1. 纯聊天:"帮我起 3 个标题" → 应该不调工具,纯文本流式
  2. 查询历史:"看看我最近做了什么作品" → 应该调 list_recent_generations
  3. 生图:"帮我生成一张小红书封面图,主题 AI 修图前后对比" → 应该调 create_image_task

每个场景验证:
  - SSE 事件序列包含 delta(自然语言)
  - 工具场景包含 tool started/done 事件
  - 工具完成后模型有"基于结果的自然回应"(不是模板)
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request

TOKEN = os.environ.get("INKVIA_DEV_TOKEN")
BASE = "http://127.0.0.1:3000"


def post(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=180)


def new_conv():
    r = post("/api/agent/conversations", {"title": "react-check"})
    return json.loads(r.read().decode("utf-8"))["conversation"]["id"]


def chat(conv_id, content):
    print(f"\n{'=' * 70}\n>>> {content}\n{'-' * 70}")
    resp = post("/api/agent/chat", {"conversationId": conv_id, "content": content})
    buf = b""
    text = []
    tool_events = []
    for chunk in resp:
        buf += chunk
        while b"\n\n" in buf:
            block, buf = buf.split(b"\n\n", 1)
            event = "message"
            data_lines = []
            for line in block.decode("utf-8", errors="replace").splitlines():
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].strip())
            raw = "\n".join(data_lines)
            if not raw:
                continue
            try:
                d = json.loads(raw)
            except Exception:
                continue
            if event == "delta" and d.get("content"):
                text.append(d["content"])
                sys.stdout.write(d["content"])
                sys.stdout.flush()
            elif event == "tool":
                tool_events.append(d)
                phase = d.get("phase")
                name = d.get("name")
                if phase == "started":
                    sys.stdout.write(f"\n[🔧 调用 {name}...]\n")
                elif phase == "done":
                    ok = d.get("ok")
                    sys.stdout.write(f"\n[{'✓' if ok else '✗'} {name} {'成功' if ok else d.get('error')}]\n")
                sys.stdout.flush()
            elif event == "done":
                print("\n")
                return "".join(text), tool_events
            elif event == "error":
                print(f"\n[ERROR] {d.get('error')}")
                return "".join(text), tool_events
    return "".join(text), tool_events


def analyze(label, reply, tools):
    print(f"--- {label} 诊断 ---")
    print(f"  工具调用次数: {len(tools)}")
    started = [t for t in tools if t.get('phase') == 'started']
    done = [t for t in tools if t.get('phase') == 'done']
    print(f"  调用的工具: {[t.get('name') for t in started]}")
    print(f"  成功的: {sum(1 for t in done if t.get('ok'))}/{len(done)}")
    print(f"  回复长度: {len(reply)} 字符")
    has_template = "我已处理你的生成请求" in reply or "你可以在作品页查看结果" in reply
    print(f"  是否包含模板字符串: {'✗ 包含模板' if has_template else '✓ 无模板'}")
    print()


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("Set INKVIA_DEV_TOKEN before running this diagnostic.")
    conv = new_conv()
    print(f"新会话 id={conv}")

    # 1. 纯聊天
    r1, t1 = chat(conv, "帮我起 3 个小红书标题,主题 AI 修图")
    analyze("场景1 纯聊天(应该不调工具)", r1, t1)

    # 2. 查询历史
    r2, t2 = chat(conv, "看看我最近做了什么作品")
    analyze("场景2 查询历史(应该调 list_recent_generations)", r2, t2)

    # 3. 生图
    r3, t3 = chat(conv, "帮我生成一张小红书封面图,主题 AI 修图前后对比,9:16 比例")
    analyze("场景3 生图(应该调 create_image_task)", r3, t3)
