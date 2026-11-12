<p align="center">

  <img src="docs/logo.svg" alt="DeepSeek Harness Remote" width="520">
</p>

<p align="center">
  <strong>DS Harness Remote · 极速分支（fork）</strong>
</p>

<p align="center">
  <a href="https://github.com/liguobao/ds-harness-remote">上游仓库</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/issues/299">上游 issue #299</a>
  &nbsp;·&nbsp;
  <a href="docs/README.md">文档</a>
  &nbsp;·&nbsp;
  <a href="https://dsh.r2049.cn/app">Web</a>
</p>

---

## 这个 fork 是什么

上游 [liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote) 的**速度优化分支**，只加一件事：
**尽量少地往远端塞数据**，让连接更快、更稳，尤其是大会话（几百条记录 + 插件投影）在弱网/中继下的首屏。

除「极速模式」和一处后端探测的性能修正（见下）外，本分支与 `upstream/main` 完全一致，跟随上游 rebase。

## 为什么单独 fork

远端首屏的整条历史快照必须塞进一条 secure 消息（`MAX_SECURE_MESSAGE_BYTES` = 4 MB）。会话一大就超限，Host 直接抛 `Oversized Harness Remote frame` 并断开——上游 issue [#299](https://github.com/liguobao/ds-harness-remote/issues/299)。

同一个会话里真正占体积的往往不是聊天正文，而是**插件投影**（`dsh-context-lens` 这类面板动辄 1–2 MB）和**几百条历史记录**，这些信息在远端大部分时候没必要传。

我们把修复做成了 Host 端开关（[PR #311](https://github.com/liguobao/ds-harness-remote/pull/311)）。上游的取向是「Host 端开关越少越好，投影强度应该由发起方在协议里约定」——方向我们认同，但当下有几个**改不了的发起方**：

- **Remote Web**（`dsh.r2049.cn`）是独立闭源前端
- **iOS** 还在 TestFlight，未公开
- **DSH Go** 是第三方 App（它内置本插件，但不会为这个功能单独加 UI）

在它们支持新参数之前，Host 端兜底是唯一能让大会话不断连的手段。所以 PR 先关掉，fork 自己维护；等上游真的落地 per-connection 参数（`projection / maxRecords / maxBytes`），这个开关会退化成「默认值」，那时再回归官方包。

## 极速模式开关在哪

Remote 弹窗里，紧挨着「允许控制本机」：**极速模式 [?] [开关]**，默认打开，切换立即生效并持久化到 `cordis.patch.yml`。

远端也可以用自然语言让 host 改：插件注册了 agent 工具 **`remote_fast_mode`**，在对话里说「打开 ds-harness-remote-fast 插件的极速模式开关」即可（弹窗里的 `?` 提示也写了这一句）。

## 强制中继（可选）

弹窗里「极速模式」右边还有一个**「强制中继」**开关，默认关。打开后客户端不再尝试局域网 / 互联网直连 / TURN，
直接走加密中继，并让 Host 只向服务器上报 `transport.relay`：首次连接和断线重连都会明显更快（省掉 12 秒的直连协商超时）。
代价是这条路线的流量全部经过服务器，P2P 能打通时反而更慢，所以默认关闭。切换对**新连接**生效，已建立的连接保持原传输方式。

## 极速模式实测（2026-11-06）

同一台 Host、同一部手机（DSH Go，`transferFrames: true`），把两个图片较多的会话各打开一次、历史各上滑两次，只在 **≥256 KB 的帧**上打点（小帧不值得记录，所以"0 条"就是"没有超过 256 KB 的帧"）：

| 场景 | ≥256 KB 的帧 | 峰值帧 | 明细 |
| --- | ---: | ---: | --- |
| 极速模式 **关** | 4 条，合计 3,284,911 B | **1,439,894 B** | snapshot 1,262,357 / 1,439,894 B；baseline 291,330 B ×2 |
| 极速模式 **开** | **0 条** | **< 262,144 B** | 两个会话连一条 ≥256 KB 的帧都没有产生 |

也就是说，这两个会话首屏最大的那一帧从 **1.44 MB 降到 256 KB 以内（降幅约 82%）**，而且不再有 291 KB 的 baseline 投影帧。

**为什么降这么多**：省下来的几乎全是**记录条数**（首屏几百条的整页 → 10 条）；工具详情压缩只是小头。插件投影（`dsh-context-lens` 这类）在 baseline 里通常是大头，被「单项 16 KB 上限 / 单帧 256 KB 总量预算」挡掉。

**它不省什么**：对话过程中的增量帧、心跳/信令、Host 侧的 CPU 与磁盘（快照照旧生成，只在出站前裁剪）。

**顺带的性能修正**：Host 每次读设置都会同步 spawn `which` 去探测 ACP 后端（实测 6 次约 21 ms，最坏会卡到 5 s 超时）。现在探测改成了异步 `execFile`，并加 30 秒 TTL 缓存，不再阻塞事件循环。

## 跟随上游

```bash
git remote add upstream https://github.com/liguobao/ds-harness-remote.git
git fetch upstream main
git rebase upstream/main      # dist 冲突时：重新 build 后再 git add packages/plugin/dist
```

`dist/` 是构建产物，每次 rebase 后都要按上面的命令重新生成并提交（上游 CI 也校验这一点）。

## 许可与致谢

代码来自 [liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote)，遵循其原许可。本分支只改「极速模式」相关逻辑和一处后端探测的性能修正，问题请先看上游 issue；确实与本分支有关再来这边提。

## npm

```bash
dsh plugin --profile web add ds-harness-remote-fast
```

包名 `ds-harness-remote-fast`（不是上游的 `ds-harness-remote`），安装不会覆盖上游的 npm 包；`cordis.patch.yml` 里的 entry id 仍是 `ds-harness-remote`，你已有的 `liteMode` 等配置不会丢。同一个 profile 里只启用其中一个。
本仓库刻意不带 `dsh-plugin` 关键词，因此**不会出现在插件市场**里，也就不会被市场更新覆盖。
