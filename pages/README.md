# MHXX 资料库的 GitHub Pages 版

这个版本可以从 GitHub Pages 或普通静态文件服务器打开。浏览器用 sql.js 读取随站点发布的 SQLite 资料库，在后台线程执行图鉴查询和配装搜索。存档编辑仍在浏览器中完成。首次加载需下载约 14 MB 的资料库。

## 本地构建和预览

在 `webapp` 仓库根目录执行以下命令。构建需要 Node.js 24 或更新版本。

```powershell
npm ci --prefix pages
npm run build --prefix pages
uv run --no-project --python 3.12 python -m http.server 8788 --bind 127.0.0.1 --directory pages/dist
```

在浏览器打开 `http://127.0.0.1:8788/`。如果已安装 Python，也可以直接执行最后一行中从 `python` 开始的部分。

## 部署到 GitHub Pages

1. 将 `webapp` 仓库推送到 GitHub，使 `.github/workflows/pages.yml` 位于仓库根目录。
2. 在 GitHub 仓库的 **Settings → Pages** 中将 **Source** 设为 **GitHub Actions**。
3. 在 **Actions → Deploy GitHub Pages** 中选择 **Run workflow**。以后发布更新也从这里运行。

工作流构建并发布 `pages/dist`。默认站点地址形如 `https://用户名.github.io/仓库名/`，资源路径会自动跟随站点所在目录。

公开发布前请确认原数据库和图标可以再分发，详见[数据与版权说明](../README.md#数据与版权)。站点会将这些资源作为文件提供给访客。
