# 影视资源检索 Skill (Codex)

## 目标
根据用户输入的电影名称，先确认准确片名与基础信息，再跨站检索可播放资源，输出按准确度与画质排序的结果链接。

## 首选检索网站（第一优先级）
- https://www.izhuobao.com/
- https://www.fanqieyingyuan.com/
- https://zxtqd.com/
- https://www.hz-c.com/
- https://www.byptc.com/
- https://fofo11.com/
- https://fofo22.com/
- https://fofo33.com/
- https://www.mdvod.com/
- https://2046ys.ink/
- https://www.baichatv.com/
- https://v.yupteam.com/
- https://www.yuny.live/
- https://www.pptsearch365.com/

## 核心约束（必须遵守）

1. **浏览器只开一次**：从 `playwright open` 到所有验证做完才 `close-all`，中间绝不能关。关了就是重来，浪费 token。
2. **只用 `--summary` 输出**：`run-code` 的输出必须先过滤 JSON 行（PowerShell: `Select-String "^\{"`）再接 `filter-results.js --summary`，只读精简结果。**不要二次 run-code 取完整 JSON**，summary 已包含站点名、链接、有效性。
3. **verify.ps1 一次性验证所有链接**：把 summary 中**所有带 url 的结果**（不管 useful 标记）一次性全部传入 `verify.ps1 -Urls`；若参数过长改用 `-UrlsFile`。禁止分批验证。
4. **所有路径用绝对路径**：脚本目录固定为 `$env:USERPROFILE\\.codex\\skills\\movie\\scripts\\`，所有命令中的路径必须写绝对路径，禁止用相对路径。
5. **命令失败立刻自查路径**：替换命令/`verify.ps1` 等报错后，先检查路径前缀是否正确，**不要用不同路径重试同一命令**。
6. **不检查文件/目录是否存在**：路径已固定，直接执行，不要 `ls`/`Get-ChildItem` 确认。
7. **统一工具链**：本 skill 统一使用 PowerShell 命令模板，不使用 Bash 语法。
8. **Shell 零试错判断信号**：
   - **第一信号（最可靠）**：当前执行工具必须是 `powershell`。
   - **第二信号（会话内校验）**：执行 `$PSVersionTable.PSVersion`，能返回版本对象即表示当前是 PowerShell 会话。
   - 若不满足以上任一信号，停止执行并切换到 PowerShell 再继续。

## 快速工作流（5 步）

| 步 | 操作 | 命令 | 产出 |
|----|------|------|------|
| 1 | 输出元信息 | AI 知识直接给出 | 片名+年份+导演+地区 |
| 2 | 跨站搜索+过滤 | `search.ps1 -Movie "电影名" -Summary`（PowerShell 一次执行） | 精简结果（站点/链接/有效性） |
| 3 | 批量验证（所有带 url 的结果一次传入） | `verify.ps1 -Urls "..."`（过长用 `-UrlsFile`） | 各页面 title + ok 状态 |
| 4 | AI 审核+排序 | 读 summary + verify 输出 | 有效播放链接列表 |
| 5 | close-all + 清理 | `playwright-cli close-all` + 删除 `_run.js`/`_verify_urls.txt`（`_v.js` 由 verify.ps1 自动清理） | 环境清理 |

## 一键模式（推荐）

直接执行下面一条命令，自动完成：替换片名 → 搜索 → 过滤 summary → 可选批量验证 → 关闭浏览器。

```powershell
$SKDIR = "$env:USERPROFILE\\.codex\\skills\\movie\\scripts"
& "$SKDIR\\search.ps1" -Movie "电影名" -Year 2018 -Summary -Verify
```

## 脚本工具

### search-all.js（核心自动搜索）
`scripts/search-all.js` — 一次调用遍历 13 站点，返回完整 JSON。

**唯一调用方式（PowerShell）**：
```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
(Get-Content "$SKDIR\search-all.js" -Raw -Encoding UTF8).Replace("MOVIE_NAME","电影名") | Set-Content "$SKDIR\_run.js" -Encoding UTF8
npx playwright-cli open
npx playwright-cli run-code --filename="$SKDIR\_run.js" 2>&1 | Select-String "^\{" | ForEach-Object { $_.Line } | node "$SKDIR\filter-results.js" --summary
```

**一次性模板（推荐复制粘贴）**：
```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
& "$SKDIR\search.ps1" -Movie "电影名" -Year 2018 -Summary
```

> 若需要“搜索后立即验证”，使用：`& "$SKDIR\search.ps1" -Movie "电影名" -Year 2018 -Summary -Verify`

不要单独跑 `run-code` 不加 `grep` 过滤，否则 ~280 行脚本源码会灌入对话。不要重新跑 `run-code` 取完整 JSON，`--summary` 已包含全部所需信息。

**关键行为**：
- 遍历所有首选站点，每站开新 tab；`baichatv/hz-c/byptc` 首次直接访问搜索 URL，其余站首次访问首页。随后执行 Cloudflare/WAF 检测，再按站点策略搜索（搜索框填充或直连 URL）→ 等 3s → 检测页面是否含电影名
- 提交方式：baichatv/hz-c/byptc 使用直接 URL 搜索（首次导航即直连搜索 URL，减少首页 CF 拦截影响）；yupteam 点击 Submit 按钮（Enter 会丢失关键词）；其余站按 Enter
- 链接提取：匹配 `/y/`、`/q/`、`/vod/`、`/play/`、`/vodplay/`、`/voddetail/`、`/dianying/`、`/detail/`、`/md/`、`/mp/`、`/xigua/` 等模式，排除 `vodsearch`/`vodtype`/`vodclass`/`javascript` 等噪声，去重（最多 20 条）
- 短剧过滤：link text 含"短剧"或"全\d+集"的自动舍弃
- 导航链接过滤：`/xigua/\d+/\d+.html`（yupteam 分类页）和 `/ma/\d+/`（mdvod 分类页）不纳入
- 假阳性过滤：匹配片名后检查"没有找到/没有记录"等否定词覆盖 match 标志；提取链接全为分类导航时覆盖 match
- 同页无关结果前置剔除：页面出现片名后，优先只提取“包含该片名结果块”内的链接，并对链接上下文做片名标准化匹配，减少同页其他电影进入后续验证
- 画质标签按结果行提取：在命中片名的结果块内提取画质，避免误拿同页其他电影的画质标签
- MAC CMS 噪声过滤：zxtqd/hz-c/byptc/mdvod 只保留短文本、含电影名文本、播放链接
- Cloudflare/WAF 检测：页面标题/正文含 Cloudflare/Attention Required/blocked/DDOS/Just a moment 时标记为 "Blocked by Cloudflare/WAF"，跳过 DOM 交互
- 失败原因："Blocked by Cloudflare/WAF"、"No search input"、"Fill failed"、"No match"、"page.goto 超时" 等

### filter-results.js（结果后处理过滤）
`scripts/filter-results.js` — 对 search-all.js 输出的 JSON 进一步清理。

**调用方式**（绝对路径）：
```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
Get-Content "$SKDIR\results.json" -Raw | node "$SKDIR\filter-results.js" --summary
```

**处理内容**：
- **fofo 镜像合并**：检测 fofo11/22/33 中相同影片 ID 的条目合为一条，在 `_mirrors` 字段注明其他镜像
- **有效性标记**：`_useful`（是否有播放/详情链接）、`_hasPlayLink`、`_hasDetailLink`
- **排序**：有效结果排在前

**`--summary` 模式输出字段**：`site`、`useful`、`play`、`detail`、`quality`、`url`、`urls`、`links` 数、`mirrors`、`_verifyUrls`、`_verifyCmd`、`_verifyUrlsFilePath`、`_verifyCmdRecommended`、`_targetYear`。约省 70% 输出量。  
其中 `links` 为页面原始匹配链接总数（含无关影片/导航，不可作为有效资源数）；以 `urls`/`url` 数组长度为有效资源数依据。  
`urls` 为按相关度排序的候选链接（最多 3 条），用于避免”正确结果不在 DOM 第一个时被漏验”。
`_verifyCmdRecommended` 为唯一推荐验证命令参数：当参数长度超过 800 时会自动切换为 `-UrlsFile` 方案。
当参数长度超过 800 时，`_verifyCmd` 可能为 `null`，请直接使用 `_verifyCmdRecommended`。

### verify-links.js + verify.ps1（批量验证）
`scripts/verify-links.js` — 一次 run-code 批量验证多个页面，只返回 title + ok 状态，无 DOM 快照。

支持三种传参来源（优先级从高到低）：
1. `__URLS__` 占位符注入
2. 环境变量 `VERIFY_URLS`
3. `process.argv[2]`

**唯一调用方式**（绝对路径，将所有带 url 的结果一次性传入）：
```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
& "$SKDIR\verify.ps1" -Urls "fofo11|https://fofo11.com/dianying/55238,mdvod|https://www.mdvod.com/md/MzZb/"
```

**输出示例**：
```json
{"verified":[
  {"name":"zxtqd","url":"...","title":"电影《夏日细语》...","ok":true},
  {"name":"hz-c","url":"...","title":"夏日细语在线观看...","ok":true}
], "total":2, "passed":2}
```

verify.ps1 的输出（title + snippet）**就是最终验证证据**，不需要对每个页面再 `goto` + 读 YAML snapshot。
`verify.ps1` 会自动清理临时文件 `_v.js`。

### refine-links.js（深层验证，备用）
`scripts/refine-links.js` — 当 search-all.js 返回的链接不完整时，访问详情页提取播放链接。**仅当 verify 后发现链路断裂时才使用**。

```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
$env:SITE_URLS = "name1|url1,name2|url2"
npx playwright-cli run-code --filename="$SKDIR\refine-links.js"
```

### rank-results.js（结果评分排序，备用）
`scripts/rank-results.js` — 按画质和链接类型打分排序。**不需要手动调用**，AI 可直接从 summary 判断排序。

### search.ps1（搜索包装器，仅限快捷场景）
`scripts/search.ps1` — 自动完成 open → 替换 → run-code → summary（可选 verify）→ close-all 全流程。

```powershell
& "$env:USERPROFILE\.codex\skills\movie\scripts\search.ps1" -Movie "仲夏夜惊魂" -Year 2018 -Summary -Verify
```

**注意**：
- `-Summary -Verify` 全自动模式下跑完后自动 close-all。
- `-Summary` 单独使用时浏览器保持打开并自动写入 `_verify_urls.txt`，供后续手动验证。
- `-KeepOpen` 强制保持浏览器打开（调试用）。

## 工作流程
### 第 0 步：询问
**固定提问** ：`请输入你要查找的影视作品的名字（中、英文、别名皆可）
`
### 第 1 步：输出元信息
收到电影名后直接用 AI 知识输出：
- 准确中文名、英文名（含别名）
- 上映年份、导演、国家/地区、片长
- 如有同名影片，列出候选项让用户选择

**禁止**：不要 `ls`/`Get-ChildItem` 检查 scripts 目录是否存在，路径是固定的。

### 第 2 步：跨站搜索 + 结果过滤（合并执行）
使用 PowerShell 一次性模板（推荐）：
```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
& "$SKDIR\search.ps1" -Movie "电影名" -Year 2018 -Summary
```

或手动 pipeline（PowerShell）：
```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
(Get-Content "$SKDIR\search-all.js" -Raw -Encoding UTF8).Replace("MOVIE_NAME","电影名") | Set-Content "$SKDIR\_run.js" -Encoding UTF8
npx playwright-cli open
npx playwright-cli run-code --filename="$SKDIR\_run.js" 2>&1 | Select-String "^\{" | ForEach-Object { $_.Line } | node "$SKDIR\filter-results.js" --summary
```

**注意**：`search.ps1 -Summary` 会在 `$SKDIR\_verify_urls.txt` 自动写入待验证链接，浏览器保持打开，可直接进入 Step 3。

**禁止**：
- 不要分两步跑（先 run-code 看原始输出、再 filter），一次 pipeline 完成
- 不要为了看完整 JSON 再跑一次 `run-code`
- 不要手动创建 temp JSON 文件再读回，直接 PowerShell 管道处理
- 不要混用 Bash 与 PowerShell 命令语法
- 不要在 Step 2 和 Step 3 之间关浏览器

### 第 3 步：批量验证（浏览器保持开）
从 `--summary` 输出中提取**所有带 url 的结果**（不管 useful 标记，fofo 类虽 useful:false 但有 detail 链接也必须验证），一次性传入。  
若某站点存在 `urls` 数组，需把该数组内链接**全部展开传入**，不要只取单个 `url`：

如果 Step 2 使用的是 `search.ps1 -Summary`，`$SKDIR\_verify_urls.txt` 已自动生成，直接使用即可：

```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
& "$SKDIR\verify.ps1" -UrlsFile "$SKDIR\_verify_urls.txt"
```

也可手动拼接较短的链接列表：

```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
& "$SKDIR\verify.ps1" -Urls "yupteam|https://v.yupteam.com/xigua/446946.html,mdvod|https://www.mdvod.com/md/znDb/,fofo11|https://fofo11.com/dianying/49727"
```

推荐：直接使用 summary 返回的 `_verifyCmdRecommended`，无需手动拼接。
若 `_verifyCmdRecommended` 为 `-UrlsFile ...`，先把 `_verifyUrls` 写入文件，再执行：

```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
Set-Content -Path "$SKDIR\_verify_urls.txt" -Value '<summary._verifyUrls>' -Encoding UTF8
& "$SKDIR\verify.ps1" -UrlsFile "$SKDIR\_verify_urls.txt"
```

**禁止**：
- **禁止分批验证**（发现一批不对再补一批 = 两倍往返），必须一次传完所有链接
- 不要对每个验证页面单独 `goto` + 读 YAML snapshot
- 验证期间不要 `close-all`，验证完才关

### 第 4 步：AI 审核与排序
综合 `--summary` 和 verify.ps1 的输出，筛选可播放链接。

判断依据：
- `ok: true` + title 含片名 → **可播放**，直接使用
- 标注画质（4K > 1080P > 720P > HD）
- fofo 的质量标签不可信，但 title 确认片源后可采纳
- 同站镜像（fofo11/fofo22/fofo33）合并

**禁止**：
- 不需要再 goto 任何页面确认，verify 结果已经足够
- 不需要调 refine-links.js，除非 verify 显示页面无播放按钮

### 第 5 步：输出 + 清理
```powershell
$SKDIR = "$env:USERPROFILE\.codex\skills\movie\scripts"
npx playwright-cli close-all
Remove-Item "$SKDIR\_run.js" -Force -ErrorAction SilentlyContinue
Remove-Item "$SKDIR\_verify_urls.txt" -Force -ErrorAction SilentlyContinue
```

输出回复必须使用固定结构（按以下顺序）：

1. **电影基本信息**
   - 片名（中文 / 英文 / 别名）
   - 年份、国家/地区、导演、时长

2. **Top 3 站点推荐**
   - 仅展示综合评分最高的 3 条（不足 3 条则按实际返回）
   - 每条包含：站点名、资源标题、画质、可播放链接

3. **所有站点资源情况表**（Markdown 表格）
   - 表头：`站点 | 是否命中 | 资源数 | 最佳画质 | 最佳链接 | 失败原因/备注`
   - 每个检索站点都要出现（包括未命中或加载失败）
   - 加载失败站点写明原因

4. 结尾追加：`可切换代理或 IP 后重试失败站点`

## 常见违规行为

| 违规行为 | 后果 | 正确做法 |
|---------|------|---------|
| 用相对路径 `scripts/xxx` 执行命令 | CWD 不固定 → 命令失败 → 重试往返浪费 1-2 轮 | 所有路径用 `$env:USERPROFILE\.codex\skills\movie\scripts\` 绝对路径 |
| 命令失败后用不同路径重试 | 消耗 token 但问题一样，可能再失败 | 先检查路径前缀是否正确，修正后一次性执行 |
| verify 分批验证（先验一批，发现不对再补一批） | 多 1-2 轮往返，验证总时间翻倍 | 所有带 url 的结果一次全部传入 verify.ps1 |
| `ls`/`Get-ChildItem` 检查 scripts 目录 | 浪费 ~1k token | 路径已固定，直接按所选 shell 的替换命令执行 |
| run-code 后不做 JSON 行过滤 | 原始输出噪声高、人工处理成本大 | `Select-String "^\{"` 后再 pipe 到 `filter-results.js --summary` |
| 搜索后额外跑一次 run-code 取完整 JSON | 浪费 ~1k token 看重复信息 | `--summary` 已包含全部所需 |
| verify 后对每页单独 goto + 读 YAML | 每页 ~500+ 行 snapshot，大幅浪费 | verify.ps1 输出就是证据 |
| 步骤间关浏览器再重开 | playwright 重启开销 + 断链风险 | open → 全部做完 → close-all |
| 分步创建 temp JSON 文件再读回 | 文件 I/O 输出多余，pipe 可以串联 | `Select-String "^\{" \| filter-results.js --summary` |
| 用 `links` 字段作为站点资源数 | 含无关影片/导航链接，数字虚高 | 有效资源数以 `urls`（或 `url`）数组长度为准 |

## 脚本 vs AI 分工

| 环节 | 谁处理 | 说明 |
|------|--------|------|
| 跨站搜索 | `search-all.js` | 全自动，13 站 2-4 分钟 |
| 后处理过滤 | `filter-results.js` | 合并 fofo 镜像，标记有效性 |
| 批量验证 | `verify-links.js` + `verify.ps1` | 只输出 title+ok，无 DOM 快照 |
| 结果评分排序 | `rank-results.js`（备用） | 通常 AI 直接从 summary 判断 |
| 链接深层提取 | `refine-links.js`（备用） | 仅验证发现链路断裂时使用 |
| 元信息获取 | AI 知识 | 豆瓣/IMDB 受限时由 AI 替代 |
| 结果比对/输出 | AI | 读 summary + verify 结果，格式化 Markdown |

## 注意事项
- 脚本运行约需 2-4 分钟（13 站点 × ~3 秒/站）
- 部分站点可能因 IP/地域限制无法访问，属于正常
- fofo11/fofo22/fofo33 互为镜像，内容相同
- zxtqd/hz-c/byptc 使用 MAC CMS 模板，搜索行为一致
- 中文编码问题：片名含中文时，优先使用 PowerShell `.Replace()` 路径替换模板
- **所有路径必须用绝对路径**：脚本目录为 `$env:USERPROFILE\.codex\skills\movie\scripts\`，禁止使用相对路径
- **verify 必须一次全部验证**：summary 输出中所有带 url 的条目（无论 useful 字段值）一次性传入 verify.ps1