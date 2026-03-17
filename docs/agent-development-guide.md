# Agent 开发指南

本文档介绍如何基于 PuerTsAgent 框架定义和开发一个智能体（Agent）。

## 概述

在本框架中，一个智能体的行为和能力完全由一个**资源目录**（Resource Root）下的文件定义。不同的资源目录代表不同的智能体——可以是 Unity 编辑器助手、游戏内 NPC、或任何你需要的角色。

## 目录结构

以内置的 `editor-assistant` 为例，一个智能体的资源目录结构如下：

```
Resources/LLMAgent/editor-assistant/
├── system-prompt.md.txt          # 角色定义（System Prompt）
├── skills/                       # 领域技能（按需加载）
│   └── puerts-interop.md.txt
└── builtins/                     # 内置模块（按需加载）
    ├── scene-view.mjs
    ├── type-reflection.mjs
    └── unity-log.mjs
```

所有资源文件放在 Unity 的 `Resources/` 目录下。

> **文件后缀约定**：Unity `Resources` 不支持 `.md` 和 `.mjs` 作为 TextAsset，因此：
> - Markdown 文件使用 `.md.txt` 后缀
> - JS 模块文件使用 `.mjs` 后缀

---

## 1. System Prompt — 角色定义

### 作用

`system-prompt.md.txt` 定义了智能体的身份、性格、能力范围和行为准则。它会被注入到 LLM 的 system prompt 最前面，是智能体"人设"的核心。

### 文件位置

```
<resource-root>/system-prompt.md.txt
```

### 格式

纯文本 / Markdown 格式，直接编写角色定义即可，无需 front-matter。

### 示例

**编辑器助手**（`editor-assistant/system-prompt.md.txt`）：

```markdown
You are a helpful AI assistant running inside Unity via PuerTS (a TypeScript/JavaScript runtime for Unity). You can help with game development, scripting, and general questions. Be concise and practical.
```

**游戏 NPC 示例**（`game-npc/system-prompt.md.txt`）：

```markdown
You are a wise old merchant named Eldric in a fantasy RPG world. You speak in a formal, slightly archaic tone. You can help the player by:
- Providing information about items, quests, and lore
- Offering trade suggestions based on the player's inventory
- Giving hints about nearby dungeons and hidden treasures

Stay in character at all times. Never break the fourth wall or mention that you are an AI.
```

---

## 2. Skills — 领域技能

### 作用

Skill 是一种**按需加载**的 Markdown 文档，为 LLM 提供特定领域的操作指南和规则。LLM 在需要时通过 `loadSkill` 工具主动加载对应技能到上下文中。

### 文件位置

```
<resource-root>/skills/<skill-name>.md.txt
```

### 文件格式

Skill 文件使用 **YAML front-matter** 声明元信息，正文为 Markdown 内容：

```markdown
---
name: <skill-id>
description: "<one-line description shown to the LLM>"
---

(Markdown body — the actual skill instructions)
```

| Front-matter 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 唯一标识符，LLM 通过此名称调用 `loadSkill` |
| `description` | ❌ | 简短描述，展示在 `loadSkill` 工具的可用技能列表中 |

### 示例

`skills/puerts-interop.md.txt`：

```markdown
---
name: puerts-interop
description: "PuerTS JS ↔ C# interop rules: CS/puer globals, out/ref params, generics, operators, Array/List indexer access, async/Task. CRITICAL: Unity edit-mode safety — use sharedMaterial/sharedMesh/DestroyImmediate instead of runtime-only APIs"
---

## PuerTS: JS ↔ C# Interop Rules

You are running in a PuerTS environment. Below are the rules for interacting between JavaScript/TypeScript and C#.

### JS Calling C#

1. **Access C# classes**: Use the global `CS` object with the full namespace path.
   ```js
   const Vector3 = CS.UnityEngine.Vector3;
   const go = new CS.UnityEngine.GameObject("myObj");
   ```
...
```

### 设计建议

- **description 要准确**：LLM 依据 description 判断是否需要加载该技能
- **内容要详尽**：技能文档是 LLM 执行特定任务的唯一参考，不要省略关键细节
- **一个领域一个技能**：保持职责单一，便于 LLM 精准加载

---

## 3. Builtin — 内置辅助模块

### 作用

Builtin 模块是 JavaScript 模块，为 LLM 的 `evalJsCode` 工具提供预置的辅助函数。与 Skill 不同，Builtin 是真正可执行的代码，而非文档。

### 文件位置

```
<resource-root>/builtins/<module-name>.mjs
```

> 源码可以使用 TypeScript、JavaScript 或任何能编译为 `.mjs` 的语言，工程结构和位置不限。框架只关心最终放在资源目录下的 `.mjs` 文件。

### 模块约定

每个 Builtin 模块必须导出以下两个字符串常量：

| 导出 | 类型 | 说明 |
|---|---|---|
| `summary` | `string` | 简短摘要（约一行），始终展示在 `evalJsCode` 工具描述中 |
| `description` | `string` | 详细的函数签名和用法说明，LLM 通过 `import()` 读取 |

此外，模块导出的函数就是 LLM 在 `evalJsCode` 中可以调用的实际功能。

### 示例

`builtins/unity-log.mjs`（以 TypeScript 源码形式展示）：

```typescript
// ---- Summary for tool description (always in context) ----
export const summary = `**unity-log** — Unity console log access (retrieve and summarize recent logs). Read \`.description\` to see available functions and their signatures.`;

// ---- Description for on-demand access via import ----
export const description = `
- **\`getUnityLogs(count?, logType?)\`** — Get recent Unity console logs.
  - \`count\` (number, default 20): Number of log entries to retrieve (1-50).
  - \`logType\` (string, default \`'all'\`): Filter by type — \`'all'\`, \`'error'\`, \`'warning'\`, or \`'log'\`.
  - Returns an array of log entry objects: \`{ timestamp, type, message, stackTrace? }\`.
`.trim();

// ---- Function implementations ----
export function getUnityLogs(count: number = 20, logType: string = 'all'): LogEntry[] {
    // Parameter validation...
    const logsJson = CS.LLMAgent.UnityLogBridge.GetRecentLogs(count, logType);
    return JSON.parse(logsJson);
}
```

### 设计建议

- **summary 尽量简短**：它始终占用 token，只需告知模块用途即可
- **description 要列出完整签名**：LLM 必须先读 description 才能正确调用函数
- **函数要做参数校验**：LLM 可能传入错误参数，校验后抛出有意义的错误信息
- **支持 top-level await**：模块可在顶层使用 `await`（如异步初始化）
- C# 桥接层（Bridge 类）需要提前在 Unity 侧实现好

---

## 4. 完整开发流程

以创建一个名为 `game-npc` 的游戏 NPC 智能体为例：

### Step 1：创建资源目录

```
PuertsAgent/Resources/LLMAgent/game-npc/
├── system-prompt.md.txt
├── skills/
└── builtins/
```

### Step 2：编写角色定义

编辑 `system-prompt.md.txt`，定义 NPC 的身份和行为准则。

### Step 3：编写领域技能（可选）

在 `skills/` 目录下创建 `.md.txt` 文件，添加 YAML front-matter 和技能内容。

例如 `skills/inventory-system.md.txt`：

```markdown
---
name: inventory-system
description: "Game inventory system rules: item types, rarity, trade mechanics, crafting recipes"
---

## Inventory System Guide

### Item Rarity Levels
- Common (white) → Uncommon (green) → Rare (blue) → Epic (purple) → Legendary (gold)

### Trade Rules
- NPCs buy items at 50% of base value
- ...
```

### Step 4：编写辅助模块（可选）

编写 Builtin 模块源文件，编译后将 `.mjs` 产物放到 `Resources/LLMAgent/game-npc/builtins/` 下。

例如 `inventory-helper`（以 TypeScript 源码形式展示）：

```typescript
export const summary = `**inventory-helper** — Query and manage player inventory. Read \`.description\` for function signatures.`;

export const description = `
- **\`getPlayerInventory()\`** — Returns the current player's inventory as an array of items.
- **\`getItemInfo(itemId)\`** — Returns detailed info about a specific item by ID.
`.trim();

export function getPlayerInventory() {
    const json = CS.GameNPC.InventoryBridge.GetInventoryJson();
    return JSON.parse(json);
}

export function getItemInfo(itemId: string) {
    if (typeof itemId !== 'string' || !itemId) {
        throw new Error(`getItemInfo: 'itemId' must be a non-empty string. Read module.description for usage.`);
    }
    const json = CS.GameNPC.InventoryBridge.GetItemInfoJson(itemId);
    return JSON.parse(json);
}
```

### Step 5
在 C# 代码中，用对应的资源路径初始化智能体：

```csharp
var agent = new AgentScriptManager();
agent.Initialize("LLMAgent/game-npc", () =>
{
    Debug.Log("Game NPC agent is ready!");
});
```

---

## 5. 最佳实践

### System Prompt
- 保持简洁明确，避免过长（它始终占用上下文 token）
- 聚焦于"你是谁"和"你应该怎么做"，不要包含框架运行时细节

### Skills
- 将复杂的领域知识拆分为独立的技能文件
- description 中包含关键词，帮助 LLM 判断何时需要加载
- 内容越详细越好——这是 LLM 执行任务的唯一参考

### Builtins
- 每个模块专注一个功能领域（如场景操作、日志查询）
- summary 一行即可，description 要完整列出所有函数签名
- 所有导出函数都应做参数校验，抛出有意义的错误信息

### 通用
- 一个资源目录 = 一个独立的智能体角色
- 不同智能体之间完全隔离，可以有完全不同的技能和工具集
