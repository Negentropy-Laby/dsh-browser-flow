---
kind: upgrade-guide
description: "Browser Flow 回执必须提供面板身份，Host 与 Client 必须加载配套构建。"
---
# Browser Flow 回执归属

[English](guide.md) | 中文

## 变更

`POST /api/browser-flow/result` 必须包含非空 `instanceId`。Host 仅接受实际取走命令的面板及连接代次在当前授权 epoch 下提交的回执。缺少身份属于协议错误；其他面板或过期身份的回执不能结案当前命令。

同一确切 Agent 与 Session 只保留一个当前控制页。成功授权另一页面会结束原授权；授权失败则保留原授权。UI 撤销立即停用本地控制，即使 Host 请求失败也不恢复。

## 迁移

1. 完全退出 Desktop，用 `npm run build` 构建链接的插件，再通过现有 Desktop profile 重启，确保 Host 与 Client 加载同一候选。
2. 自定义回执发送方必须携带注册时的面板 `instanceId`，并回传已交付命令的租约、代次、epoch、ID 和 sequence。重新授权必须由用户再次显式操作。
3. 运行协议和控制归属测试，再验证撤销后拒绝新动作且页面仍保留。本地测试不能替代真实 Desktop 验证。
