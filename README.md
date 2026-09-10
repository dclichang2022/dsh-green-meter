# Green DSH Desktop

**给 DeepSeek Harness（DSH）做的开源桌面应用：一边用 AI 干活，一边看清这次对话花了多少电、排了多少碳、省了多少钱。**

无论你跑本地模型，还是接云端 API（DeepSeek / OpenRouter / 自建中转站…），它都能把每一次请求的能耗、碳排和费用算清楚、亮出来，并在烧钱烧碳的时候提醒你。

[English](README.en.md) · 中文

---

## 它能做什么

### 1. 开箱即用的 DSH 桌面版

- 自带 Node.js 24 运行时和完整 DSH 发行版，**装完即用**，不需要 Node / pnpm / Python；
- 完整的 DSH 对话体验：模型管理、会话、工具调用、技能、子代理、工作流都在；
- Windows 安装包 + 便携版（zip 解压即用）。

### 2. 能耗 / 碳排控制台（主窗口）

| 页面 | 你能看到什么 |
| --- | --- |
| **控制台** | 本地碳排、本地能耗（估算与实测并列）、云端碳排（公开系数估算）、已省 API 费用；**近 30 天碳排**和**按任务轮次碳排**两张柱状图；硬件实时环图 |
| **会话** | 每个会话的 token、能耗、碳排、电费、省 API 费用 |
| **硬件监测** | NVIDIA 显卡全量遥测（显存 / 使用率 / 温度 / 功耗，**多卡支持**）；核显作为扩展监测；CPU / 内存曲线 |
| **预警** | 超支和异常提醒，见下 |
| **数据源** | 接入 OpenRouter 或自有中转站，拉取**真实花费**与 token 用量 |
| **参考数据** | 每个系数的出处与年份，全部可查证 |
| **碳台账** | 每一步的 JSONL 明细、实测能耗列、一键导出 CSV |
| **日志 / 设置** | harness 输出、碳强度 / 电价 / API 价格等基线设置 |

### 3. 两条计量路径（核心设计）

- **本地模型 → 实测**：检测到 NVIDIA 显卡后，持续采样功耗并积分，得到**真实能耗**，并按时间归属到每个请求步骤；需要每个模型自己的系数时，一键标定出本机的 J/token；
- **云端 API → 公开系数估算**：云端只能看到 token，因此 token→能耗一律用**公开权威系数**（不用本地标定去推演云端）。

### 4. 预警：在烧钱烧碳时提醒你

- **阈值类**：单会话能耗 / 费用、近 1 小时 / 24 小时费用、中转站日均花费；
- **异常类**：单步能耗离群（稳健 z 分数）、**上下文重读**（输入:输出比过高，反复重读上下文的无效消耗）、**空转 / 重试循环**（连续多步几乎没有产出）、缓存命中率偏低；
- 严重级预警同时弹**桌面通知**。

### 5. 对话内嵌仪表盘

聊天窗口右上角常驻碳排卡片：本会话碳排 / 能耗 / 电费、已省 API 费用、本地 vs 云端对比、每轮能耗柱状图、全部会话累计。

### 6. 本地小模型开箱支持

自带 Qwen2.5-0.5B（CPU 推理）的接入脚本和 provider 配置，一条命令起服务，即刻体验"本地模型 + 实测计量"的完整闭环；换更大的模型只需改一行模型路径。

---

## 截图

| 控制台总览 | 对话内嵌仪表盘 |
| --- | --- |
| ![控制台总览](docs/images/console-overview.png) | ![对话内嵌仪表盘](docs/images/chat-dashboard.png) |

| 硬件监测（NVIDIA 多卡） | 预警 |
| --- | --- |
| ![硬件监测](docs/images/console-hardware.png) | ![预警](docs/images/console-alerts.png) |

| 会话明细 | 数据源（中转站） |
| --- | --- |
| ![会话](docs/images/console-sessions.png) | ![数据源](docs/images/console-sources.png) |

| 参考数据（系数与出处） | 碳台账明细 |
| --- | --- |
| ![参考数据](docs/images/console-reference.png) | ![碳台账](docs/images/console-ledger.png) |

---

## 下载安装

从 [Releases](../../releases) 下载：

| 文件 | 说明 |
| --- | --- |
| `Green DSH Desktop Setup x.x.x.exe` | Windows 安装包（可选安装目录，桌面快捷方式） |
| `Green DSH Desktop-x.x.x-win.zip` | 便携版，解压即用 |

> 安装包未做代码签名，首次启动 Windows SmartScreen 会拦截一下：**更多信息 → 仍要运行**。
> 升级直接运行新版安装包，会话 / 凭据 / 台账 / 设置自动保留。

## 快速上手（三步）

1. **装好打开** → 首次会提示配置模型（DSH 设置页里填 API Key，或用本地模型）；
2. **点「打开对话」干活** → 正常聊天、写代码，什么都不用改；
3. **回到控制台** → 碳排、能耗、费用、轮次图、硬件曲线都在实时刷新；在「设置」里调好电价 / API 价格 / 碳强度，数字就是你的真实口径。

想试本地模型：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-local-model.ps1
```

然后在应用里选「本地 llama.cpp（Qwen2.5-0.5B）」即可（需先下载模型，见脚本内注释）。

---

## 数据与方法（简述）

- **本地**：token 用量 → 标定系数 → 能耗（有 NVIDIA 时以实测为准）→ 电网碳强度 → 碳排；
- **云端**：token 用量 → **公开系数** → 能耗 → 碳排；
- **费用**：API 牌价 vs 本地电费。

所有系数都标注来源与年份：

| 类别 | 数值 | 来源 |
| --- | --- | --- |
| 中国电网 | 0.5777 kgCO₂e/kWh（2024） | 生态环境部《2024 年电力碳足迹因子》 |
| 美国电网 | 0.3497 kgCO₂e/kWh | US EPA eGRID 2023 |
| 云端 per-token | 0.0006 Wh / 输出 token | Epoch AI 2025 |
| 云端 per-request | 0.24 Wh / 0.03 gCO₂e | Google Cloud 2025-08-21 |
| 本地标定 | H20 请求级拟合（R² ≥ 0.998） | 本项目实验 |

**边界说明（诚实优先）**：无 GPU 实测时的本地数值是 token-profile 估算而非硬件实测；云端数值是基于公开系数的估算，不是厂商实测；碳排 = 能耗 × 电网碳强度，属工程估算，非认证核算。

---

## 从源码构建

```bash
git clone <本仓库>
cd green-dsh-desktop
npm install

# 1) 打包 green-meter / 仪表盘插件（需要 DSH 源码 checkout，可用 DSH_CHECKOUT 指定路径）
npm run vendor:plugins

# 2) 组装内置 harness（npm 安装 DSH 发行版 + 本地插件）
npm run pack:harness

# 3) 放入 Node 运行时（复制本机 node.exe 到 resources/runtime/）

# 4) 运行 / 打包
npm start
npm run dist
```

---

## 局限与说明

- 目前主要在 Windows 上开发验证；Electron 跨平台，macOS / Linux 构建路径未验证；
- 本地实测依赖 nvidia-smi（NVIDIA 显卡）；无 NVIDIA 时本地数值退化为估算，核显仅作扩展监测（只有使用率）；
- 对话数据（会话 / 凭据 / 台账）保存在安装目录的 `resources/harness/dsh-home`，卸载前请先备份（升级会自动保留）。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 [Cordis](https://github.com/cordiverse/cordis) —— 本应用是 DSH 的插件化桌面发行版；
- green-meter（本项目作者的能耗计量插件）提供 token-profile 标定；
- [llama.cpp](https://github.com/ggml-org/llama.cpp) —— 本地推理；
- [Electron](https://www.electronjs.org/) —— 桌面壳；
- 能耗 / 碳排参考数据来自生态环境部、US EPA eGRID、Epoch AI、Google Cloud 的公开披露。

## License

MIT
