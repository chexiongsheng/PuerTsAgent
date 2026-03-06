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
