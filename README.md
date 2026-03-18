# PuerTsAgent

基于 [PuerTS](https://github.com/nicknisi/puerts) + [Vercel AI SDK](https://sdk.vercel.ai/) 的 Unity Editor LLM Agent 框架。通过 PuerTS 在 Unity Editor 中嵌入 V8 引擎运行 TypeScript，实现与 OpenAI 兼容 API 的 LLM 对话交互。

## 项目结构

```
PuerTsAgent/
├── Assets/
│   ├── Scripts/
│   │   ├── Editor/
│   │   │   ├── AgentChatWindow.cs      # Editor 聊天窗口 UI
│   │   │   ├── AgentScriptManager.cs   # PuerTS 生命周期管理 & C#↔TS 桥接
│   │   │   ├── HttpBridge.cs           # C# 侧 HTTP 请求桥接（供 TS fetch polyfill 使用）
│   │   │   └── PuertsCfg.cs            # PuerTS 类型生成配置
│   │   └── Resources/
│   │       └── main.mjs                # esbuild 打包产物（勿手动编辑）
│   └── Gen/Typing/                     # PuerTS 自动生成的 C# → TS 类型声明
├── TsProject/                          # TypeScript 源码工程
│   ├── src/
│   │   ├── main.mts                    # TS 入口，导出供 C# 调用的函数
│   │   ├── agent/
│   │   │   └── agent-core.mts          # LLM 调用核心逻辑（基于 AI SDK）
│   │   ├── polyfills/                  # V8 环境 polyfill（fetch / streams）
│   │   └── stubs/                      # Node.js 内置模块空桩
│   ├── esbuild.mjs                     # esbuild 打包配置
│   ├── tsconfig.json
│   └── package.json
└── puerts/                             # PuerTS 插件源码（子模块）
```

## 环境要求

- **Unity** 2022.3+（当前使用 2022.3.62f1c1）
- **Node.js** 18+（用于构建 TypeScript）
- **PuerTS** 已集成在项目中

## 构建 TypeScript

```bash
cd TsProject
npm install
npm run build
```

构建产物输出到 `Assets/Scripts/Resources/main.mjs`，Unity 会自动识别。

如需同时进行类型检查：

```bash
npm run build:check
```

## 在 Unity 中运行

1. 用 Unity 打开本项目
2. 菜单栏 **LLM Agent → Chat Window** 打开聊天窗口
3. 点击标题栏的 **⚙ 齿轮图标** 打开设置面板，配置以下信息：
   - **API Key**：你的 LLM 服务 API Key
   - **Base URL**：API 端点地址（兼容 OpenAI 格式，如阿里云百炼 `https://dashscope.aliyuncs.com/compatible-mode/v1`）
   - **Model**：模型名称（如 `qwen-plus`）
   - **System Prompt**：系统提示词（可选）
4. 点击 **Save** 保存配置，即可开始对话

## 重新生成 PuerTS 类型声明

如果修改了 `PuertsCfg.cs` 中的类型绑定配置，需要在 Unity 中重新生成声明文件：

**PuerTS → Generate index.d.ts**

生成结果在 `Assets/Gen/Typing/csharp/index.d.ts`。

---

## Demo: AI 迷宫探索

项目附带了一个 AI 自主走迷宫的 Demo，展示 Agent 通过截屏观察 + 工具调用来探索 3D 迷宫。

### 1. 生成迷宫场景

菜单栏 **Tools → Maze Runner → Generate Maze Scene**，打开迷宫生成器窗口：

| 参数 | 说明 | 默认值 | 范围 |
|------|------|--------|------|
| Maze Width | 迷宫宽度（格数） | 8 | 4–16 |
| Maze Height | 迷宫高度（格数） | 8 | 4–16 |
| Cell Size | 每格大小（米） | 2.0 | 1.5–4.0 |
| Wall Height | 墙壁高度（米） | 1.2 | 0.5–5.0 |
| Wall Thickness | 墙壁厚度（米） | 0.2 | 0.1–0.5 |

点击 **Generate Maze Scene** 按钮，将自动生成一个完整的迷宫场景，包含：
- 使用递归回溯算法生成的随机迷宫
- 带 CharacterController 的玩家角色（起点在左下角）
- 红色目标标记（终点在右上角）
- 俯视相机
- MazeDemoManager 和 MazeAgentUI 组件

场景保存在 `Assets/Scenes/MazeDemo.unity`。

### 2. 配置 API Key

生成场景后，在 Hierarchy 中选中 **MazeDemoManager** 对象，在 Inspector 面板中配置以下字段：

| 字段 | 说明 | 示例 |
|------|------|------|
| **Api Key** | LLM 服务的 API Key（必填） | `sk-xxxxxxxx` |
| **Base URL** | API 端点地址（兼容 OpenAI 格式，留空使用默认值） | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| **Model** | 模型名称（留空使用默认值） | `qwen-plus` |
| **Max Steps** | 最大工具调用步数，0 = 无限制 | `0` |

### 3. 构建迷宫 Demo 的 TypeScript

迷宫 Demo 有独立的 TypeScript 工程 `TsMazeRunner/`，需要单独构建：

```bash
cd TsMazeRunner
npm install
npm run build
```

构建产物输出到 `Assets/Resources/maze-runner/builtins/`。

### 4. 运行 Demo

1. 打开 `Assets/Scenes/MazeDemo.unity` 场景
2. 确认 MazeDemoManager 上已配置好 API Key
3. 点击 Unity 的 **Play** 按钮进入运行模式
4. 点击屏幕右上角的 **▶ Start Exploration** 按钮启动 AI 探索
5. AI 将自动截屏观察环境、规划路径、调用移动接口来走迷宫
6. 到达终点后会自动宣布成功

运行时还可以使用以下控制按钮：
- **⏹ Stop** — 中止当前探索
- **🔄 Reset** — 重置迷宫和对话历史
