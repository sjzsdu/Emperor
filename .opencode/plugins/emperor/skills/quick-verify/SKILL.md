---
name: quick-verify
description: 快速验证技能 - 用于简单任务完成后、提交前的强制验证环节
---

# Quick Verify — 快速验证

## 概述

> **没有验证的交付 = 欺骗**

这个技能用于确保在交付任何工作前，都经过实际验证。

## 适用场景

- 简单任务完成后
- 单文件修改后
- 任何 commit/push 前
- 用户要求"帮我改一下"之后
- 太子路径A执行完后

## 核心原则

```
❌ 禁止：
- "应该可以"
- "看起来没问题"
- "之前测试过"
- 直接交付不验证

✅ 必须：
- 实际运行验证命令
- 读取真实输出
- 报告具体证据
```

---

## 验证流程

### Step 1: 识别验证命令

根据任务类型确定需要运行什么：

| 任务类型 | 验证命令 | 成功标准 |
|----------|----------|----------|
| TypeScript/JS | `build` 或 `tsc --noEmit` | exit code: 0 |
| Rust | `cargo build` | exit code: 0 |
| Python | 语法检查 | 无 SyntaxError |
| 单元测试 | `test` | 0 failures |
| 运行验证 | `run` | 符合预期输出 |
| CLI 工具 | 实际调用 | 输出正确 |

### Step 2: 执行验证

```bash
# 必须实际运行，不能只是"检查"
[运行验证命令]
```

### Step 3: 分析输出

```typescript
// 检查这些：
- exit code 是否为 0
- 是否有 error/fail 关键词
- 输出是否符合预期
- 是否有警告需要关注
```

### Step 4: 报告结果

```
### 验证结果
| 项目 | 状态 | 证据 |
|------|------|------|
| build | ✅ | exit code: 0 |
| test | ✅ | 12/12 passing |
| logic | ✅ | 输出: "Hello World" |

如果任何一项失败：
| 项目 | 状态 | 证据 |
|------|------|------|
| build | ❌ | exit code: 1, error: ... |
```

---

## 常见验证模式

### 编译验证
```bash
# TypeScript
npm run build
# 或
tsc --noEmit

# Rust
cargo build

# Go
go build ./...
```

### 测试验证
```bash
# 运行测试
npm test
# 或
cargo test

# 检查覆盖率（如果有）
npm run test:coverage
```

### 逻辑验证
```bash
# 运行程序
node index.js
# 或
cargo run

# 检查输出是否符合预期
```

### Lint 验证
```bash
# ESLint
eslint .

# Rust clippy
cargo clippy
```

---

## 输出格式模板

### 验证通过
```
### ✅ 验证通过

| 验证项 | 状态 | 证据 |
|--------|------|------|
| [build/test/run] | ✅ | [具体输出] |

结论：[任务] 完成，可交付。
```

### 验证失败
```
### ❌ 验证失败

| 验证项 | 状态 | 证据 |
|--------|------|------|
| [build/test/run] | ❌ | [错误信息] |

问题：[具体问题描述]

正在修复...
```

### 部分通过（有警告）
```
### ⚠️ 验证部分通过

| 验证项 | 状态 | 证据 |
|--------|------|------|
| build | ✅ | exit code: 0 |
| test | ⚠️ | 10/12 passing, 2 skipped |

警告：[具体警告]
建议：[处理建议]
```

---

## 强制要求

1. **必须运行实际命令** - 不能只看代码判断
2. **必须读取输出** - 不能假设成功
3. **必须报告证据** - 不能只说"没问题"
4. **失败必须修复** - 不能忽略错误

---

## Red Flags（立即停止）

- 准备 commit 但还没验证
- 说"应该没问题"但没运行
- 引用"之前的验证结果"
- 准备交付但跳过这步
- 累的时候想"差不多得了"

---

## 使用示例

### 示例 1: 简单文件修改
```
用户：帮我把配置文件里的端口改成 3001

[修改文件]

[quick-verify]
- 识别：TypeScript 项目，需要 build 验证
- 执行：npm run build
- 结果：exit code: 0

### 验证结果
| 项目 | 状态 | 证据 |
|------|------|------|
| build | ✅ | exit code: 0 |

✅ 完成，可交付
```

### 示例 2: Bug 修复
```
用户：修复登录按钮点击无反应的 bug

[修复代码]

[quick-verify]
- 识别：需要 build + test 验证
- 执行：npm run build && npm test
- 结果：build 0 errors, test 8/8 passing

### 验证结果
| 项目 | 状态 | 证据 |
|------|------|------|
| build | ✅ | 0 errors |
| test | ✅ | 8/8 passing |

✅ Bug 已修复，验证通过
```

### 示例 3: 验证失败
```
用户：帮我加一个功能

[实现功能]

[quick-verify]
- 识别：需要 build + run 验证
- 执行：npm run build
- 结果：exit code: 1, error: TS2307

### 验证结果
| 项目 | 状态 | 证据 |
|------|------|------|
| build | ❌ | TS2307: Cannot find module |

❌ 验证失败，正在修复...
```
