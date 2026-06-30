# FXLocus System Open Source

[![Open Source](https://img.shields.io/badge/Open%20Source-Yes-0ea5e9)](LICENSE)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)

本项目只包含系统前端、系统 API、Cloudflare D1 数据库结构、R2 文件存储适配、部署配置和教程；不包含真实数据库数据、不包含生产密钥、不包含原站点其它业务页面。

## 适合谁

- 没有代码经验，但想把系统部署到自己电脑和自己网站上的用户。
- 想用 GitHub 开源，并用 Cloudflare Workers、D1、R2 运行系统的用户。
- 想二次开发系统，但不想携带原数据库数据或密钥的开发者。

## 项目包含

- `app/[locale]/system`：系统页面。
- `app/api/system`：系统后端接口。
- `app/api/cron`：可选的定时清理接口。
- `components/system`：系统界面组件。
- `lib/system`、`lib/db`、`lib/storage`、`lib/d1.ts`：系统业务逻辑、D1 兼容层、R2 存储。
- `d1/schema.sql`、`d1/migrations`：数据库结构和迁移文件，不包含用户数据。
- `wrangler.toml`：Cloudflare Workers、D1、R2 部署配置模板。
- `.env.example`、`.dev.vars.example`：环境变量示例，不包含真实密钥。
- 系统页面默认带 `fxlocus 开源版 - MIT` 开源水印，位置在 [components/OpenSourceWatermark.tsx](components/OpenSourceWatermark.tsx)。

## 从零开始

请按下面顺序阅读：

1. [从零部署教程](docs/01-从零部署教程.md)
2. [系统使用教程](docs/02-系统使用教程.md)
3. [环境变量与密钥说明](docs/03-环境变量与密钥说明.md)

## 常用命令

```powershell
npm install
npm run build
npm run dev
```

Cloudflare 生产构建使用：

```powershell
npm run cf:build
```

初始化远程 D1 数据库：

```powershell
npm run d1:init:remote
```

创建第一个超级管理员：

```powershell
$env:ADMIN_EMAIL="admin@example.com"
$env:ADMIN_PASSWORD="ChangeThisPassword123!"
$env:ADMIN_NAME="管理员"
npm run d1:create-admin:remote
```

## 重要提醒

- 不要把 `.env.local`、`.dev.vars`、真实 API 密钥、R2 Secret Key 上传到 GitHub。
- `node_modules`、`.next`、`.open-next`、`.wrangler` 都已写入 `.gitignore`，正常 `git add .` 不会上传。
- Windows 本地可以用 `npm run build` 验证 Next.js 构建。`npm run cf:build` 依赖 OpenNext Cloudflare，本地 Windows 环境可能不稳定；Cloudflare 的 Linux 构建环境更适合执行这个命令。

## 官方参考

- Node.js 下载：https://nodejs.org/en/download
- Git 下载：https://git-scm.com/downloads
- GitHub 上传本地代码：https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github
- Cloudflare D1：https://developers.cloudflare.com/d1/
- Wrangler D1 命令：https://developers.cloudflare.com/workers/wrangler/commands/d1/
- Cloudflare R2：https://developers.cloudflare.com/r2/
- R2 API Token：https://developers.cloudflare.com/r2/api/tokens/
- Cloudflare Workers Builds：https://developers.cloudflare.com/workers/ci-cd/builds/
- Workers 自定义域名：https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
