# Git 与 GitHub 命令使用归纳

> 本文整理自对话中涉及的所有 Git / GitHub 相关命令，按用途分类，方便查阅。

---

## 一、基础工作流

| 命令 | 用途 |
|---|---|
| `git add <文件>` | 把工作区改动放入暂存区，准备提交 |
| `git add .` | 把当前目录所有改动放入暂存区 |
| `git add --renormalize .` | 按 `.gitattributes` 重新规范化所有文件的行尾符 |
| `git commit -m "说明"` | 把暂存区内容提交到本地仓库，生成一个版本 |
| `git status` | 查看工作区、暂存区状态，哪些文件已暂存/未暂存 |

---

## 二、查看与比较

| 命令 | 用途 |
|---|---|
| `git diff` | 工作区 vs 暂存区：还没 `git add` 的改动 |
| `git diff --cached` | 暂存区 vs 最近提交：已 `add` 但还没 `commit` 的改动 |
| `git diff HEAD` | 工作区 vs 最近提交：从上次提交到现在所有改动 |
| `git diff <commit> -- <文件>` | 某次提交 vs 当前工作区 |
| `git diff <commit1> <commit2> -- <文件>` | 比较两次提交里同一个文件的差异 |
| `git diff HEAD^ -- <文件>` | 上一次提交 vs 当前工作区 |
| `git diff HEAD^ HEAD -- <文件>` | 上一次提交 vs 当前提交 |
| `git diff --stat` | 只看增删统计，不显示具体代码 |
| `git diff --name-status` | 只看文件名和状态（A/M/D） |
| `git diff -w` | 忽略空白字符差异 |
| `git diff --word-diff` | 按单词而不是按行显示差异 |
| `git show <commit>` | 查看某次提交的元数据 + 它引入的改动 |
| `git show HEAD` | 查看最近一次提交的详细信息 |
| `git show <commit> --stat` | 只看某次提交改了哪些文件、增删行数 |
| `git show <commit> --name-only` | 只看某次提交涉及的文件名 |
| `git show <commit> --name-status` | 文件名 + 状态（新增/修改/删除） |
| `git show <commit>:<文件>` | 查看某次提交里某个文件的完整内容 |
| `git show HEAD^:doc/temp.js` | 查看上一次提交里某个文件的内容 |
| `git show HEAD --name-only` | 查看最近一次提交包含哪些文件 |
| `git log` | 查看提交历史（哈希、作者、日期、说明） |
| `git log --oneline` | 一行一个提交，最简略 |
| `git log --stat` | 提交历史 + 每次提交的文件统计 |
| `git log --name-only` | 提交历史 + 只列文件名 |
| `git log --name-status` | 提交历史 + 文件状态 |
| `git log -p` | 提交历史 + 每次提交的具体 diff |
| `git log --follow -- <文件>` | 查看某个文件的完整历史（含改名） |
| `git log -5 --stat` | 只看最近 5 次提交的统计 |
| `git --no-pager diff/show/log` | 不分页显示，直接输出到终端 |
| `git check-attr -a -- <文件>` | 查看某文件在 Git 中的属性（如是否被当作文本） |

---

## 三、撤销与回退

| 命令 | 用途 |
|---|---|
| `git reset --soft HEAD~1` | 删除最近一次提交，改动保留在暂存区 |
| `git reset --mixed HEAD~1` | 删除最近一次提交，改动保留在工作区（默认） |
| `git reset --hard HEAD~1` | 删除最近一次提交，并丢弃所有改动（危险） |
| `git reset HEAD~1` | 同 `--mixed` |
| `git reset --hard <commit>` | 回退到指定提交，丢弃之后所有改动 |
| `git reset HEAD <文件>` | 把文件从暂存区撤出，改动回到工作区 |
| `git revert <commit>` | 生成一个反向提交，抵消某次提交的改动（安全，不改历史） |
| `git checkout <commit> -- <文件>` | 把某个文件回退到指定提交的版本 |
| `git restore --source=<commit> -- <文件>` | 同上，新版 Git 推荐 |
| `git restore --source=HEAD -- <文件>` | 把文件恢复到最近一次提交的版本 |
| `git restore --staged <文件>` | 把文件从暂存区撤出 |
| `git update-ref -d HEAD` | 删除当前分支的唯一提交（仓库初始化后误提交时用） |
| `git reflog` | 查看 HEAD 移动记录，用于找回被 reset 掉的提交 |
| `git rebase -i HEAD~n` | 交互式变基，可删除/合并/修改历史中的某次提交 |
| `git cherry-pick <commit>` | 把某次提交的改动应用到当前分支 |

---

## 四、远程与同步

| 命令 | 用途 |
|---|---|
| `git remote -v` | 查看当前关联的远程仓库地址 |
| `git remote add origin <url>` | 添加远程仓库，别名为 `origin` |
| `git remote set-url origin <url>` | 修改远程仓库地址 |
| `git remote remove origin` | 删除远程仓库关联 |
| `git remote show origin` | 查看远程仓库详细信息，包括分支跟踪情况 |
| `git push -u origin master` | 推送本地 `master` 到远程，并设置默认上游 |
| `git push origin master` | 推送本地 `master` 到远程，但不设置上游 |
| `git push` | 已设置上游后，直接推送到默认远程分支 |
| `git push --force` | 强制推送，用本地历史覆盖远程（危险） |
| `git push --force-with-lease` | 更安全的强制推送，远程有新提交时会拒绝 |
| `git fetch origin` | 下载远程最新状态，更新 `origin/master`，不动本地分支 |
| `git fetch --all` | 拉取所有远程的最新状态 |
| `git fetch --prune` | 清理远程已删除的分支引用 |
| `git pull origin master` | 拉取远程 `master` 并合并到当前分支（fetch + merge） |
| `git pull` | 已设置上游后，直接从默认远程分支拉取并合并 |
| `git pull --rebase origin master` | 拉取远程并变基，保持历史线性 |
| `git pull --allow-unrelated-histories` | 合并两个无共同历史的仓库 |
| `git merge origin/master` | 把远程跟踪分支合并到当前本地分支 |
| `git branch -vv` | 查看本地分支及其上游跟踪关系 |
| `git branch -a` | 列出本地和远程所有分支 |
| `git branch -r` | 列出远程跟踪分支 |
| `git branch -M main` | 把当前分支重命名为 `main` |
| `git branch --set-upstream-to=origin/master` | 手动设置当前分支的上游 |
| `git branch --unset-upstream` | 取消当前分支的上游设置 |
| `git switch -c <本地分支> origin/<远程分支>` | 基于远程分支创建并切换到本地分支 |
| `git switch <分支>` | 切换分支 |
| `git checkout <分支>` | 旧版切换分支命令 |

---

## 五、配置与属性

| 命令 | 用途 |
|---|---|
| `git config --global --get http.proxy` | 查看 Git 的 HTTP 代理设置 |
| `git config --global --get https.proxy` | 查看 Git 的 HTTPS 代理设置 |
| `git config --global --unset http.proxy` | 清除 HTTP 代理 |
| `git config --global --unset https.proxy` | 清除 HTTPS 代理 |
| `git config --global http.proxy http://127.0.0.1:7897` | 设置 HTTP 代理（Clash 混合端口 7897） |
| `git config --global https.proxy http://127.0.0.1:7897` | 设置 HTTPS 代理 |
| `git config --global http.proxy socks5://127.0.0.1:7897` | 设置 SOCKS5 代理 |
| `git config --system http.sslBackend openssl` | 切换 SSL 后端（需管理员权限） |
| `git config --global core.autocrlf` | 查看行尾符自动转换配置 |
| `git config --global core.safecrlf false` | 关闭行尾符安全警告 |
| `git config core.autocrlf false` | 对当前仓库关闭行尾符转换 |
| `git config core.eol` | 查看行尾符风格配置 |
| `.gitattributes` | 文件属性配置，如 `* text=auto`、`*.js text eol=lf`、`*.docx binary` |

---

## 六、GitHub 相关

| 操作 | 说明 |
|---|---|
| 创建 GitHub 仓库 | 网页上 New repository，不要勾选 README/gitignore/license |
| 关联远程 | `git remote add origin <url>` 或 `git remote set-url origin <url>` |
| 推送 | `git push -u origin master`（或 `main`） |
| 认证 | HTTPS 用 Personal Access Token；SSH 需配置密钥 |
| 强制推送 | `git push --force-with-lease`，仅在个人分支且确定要覆盖时使用 |
| 查看提交历史 | GitHub 仓库页 → Commits；文件页 → History |
| 保留所有提交 | 普通 `git push` 只追加，不覆盖；强制推送才会覆盖远程历史 |
| 注意 | 不推送敏感信息；单文件 >100MB 会被拒绝；`.docx` 是二进制，GitHub 不显示差异 |

---

## 七、其他常用

| 命令 | 用途 |
|---|---|
| `git mv <旧> <新>` | 重命名/移动文件，Git 会记录为 rename |
| `git branch` | 查看本地分支 |
| `git switch <分支>` | 切换分支（新版） |
| `git checkout <分支>` | 切换分支（旧版） |
| `cd <目录>` | 切换本地仓库目录 |

---

## 八、概念区分

| 概念 | 说明 |
|---|---|
| `git remote` | 管理远程仓库别名和地址，如 `origin` |
| `git branch` | 管理本地分支，如 `master`、`dev` |
| `origin/master` | 远程跟踪分支，由 `git fetch` 更新，记录远程 `master` 上次同步状态 |
| 上游（upstream） | 本地分支默认对应的远程分支，如 `master` 的上游是 `origin/master` |
| 暂存区（index/staging） | 准备提交的改动缓冲区，`git add` 放入，`git commit` 提交 |
| 工作区 | 你实际编辑文件的地方 |
| 本地仓库 | `.git` 目录，保存所有提交历史 |
| 远程仓库 | GitHub 等托管平台上的仓库 |

---

以上命令均出自实际对话中涉及或建议的内容。