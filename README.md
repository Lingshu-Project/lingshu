# 灵书 Markdown / Lingshu 0.3.0

项目来源：[灵书 / Lingshu Project](https://github.com/Lingshu-Project/lingshu)。允许分支、修改和商业使用，采用含门槛分成的自定义源码公开许可，详见 [LICENSE](LICENSE)。

Windows 本地 Markdown 写作工具，采用单栏即时排版，并提供源码编辑、大纲、专注写作、浅深外观、PDF/HTML 导出和自定义 CSS 主题。

## 运行

将便携包完整解压到同一文件夹，双击 `Lingshu.exe`。不要只移动这一个 EXE，它需要同目录的运行文件。

首次打开选择「简体中文」或「English」，之后会自动恢复所选语言。「语言」按钮或 Ctrl+, 可重新选择。切换保留当前未保存内容，但会重建富文本编辑器并清除此前的富文本撤销历史。用户自己的文档、路径、CSS 和编程语言名称不会被翻译。

点击「打开」选择 `.md`、`.markdown`、`.mdown` 或 UTF-8 `.txt`；点击「保存」，或按 Ctrl+S。首次保存会询问文件位置。可将 Markdown 文件路径作为命令行参数打开。

| 操作 | 快捷键 |
| --- | --- |
| 新建 | Ctrl+N |
| 打开 | Ctrl+O |
| 保存 | Ctrl+S |
| 另存为 | Ctrl+Shift+S |
| 导出 | Ctrl+Shift+E |
| 源码 / 排版 | Ctrl+/ |
| 侧栏 / 大纲 | Ctrl+Shift+L / Ctrl+Shift+1 |
| 专注 / 打字机 | F8 / F9 |
| 查找 / 替换 | Ctrl+F / Ctrl+H |
| 标题 1–6 / 普通段落 | Ctrl+1–6 / Ctrl+0 |
| 加粗 / 斜体 / 下划线 | Ctrl+B / Ctrl+I / Ctrl+U |
| 代码块 / 公式块 / 表格 | Ctrl+Shift+K / Ctrl+Shift+M / Ctrl+T |
| 引用 / 有序列表 / 无序列表 | Ctrl+Shift+Q / Ctrl+Shift+[ / Ctrl+Shift+] |
| 增加缩进 / 减少缩进 | Ctrl+[ / Ctrl+]；列表内也可用 Tab / Shift+Tab |
| 行内代码 / 删除线 | Ctrl+Shift+反引号 / Alt+Shift+5 |
| 超链接 / 图片 | Ctrl+K / Ctrl+Shift+I |
| 清除格式 | Ctrl+反斜杠 |
| 复制为 Markdown / 粘贴纯文本 | Ctrl+Shift+C / Ctrl+Shift+V |
| 全屏 / 实际大小 | F11 / Ctrl+Shift+0 |

输入 `# `、`- `、`> ` 等 Markdown 语法可转换为对应块；三个反引号后可写编程语言，再按 Enter 创建代码块；`$$` 后按 Enter 创建公式块。选中文字可使用浮动工具栏。支持任务列表、`==高亮==`、`<u>下划线</u>`、行内 `$公式$` 及公式块。代码编辑提供 143 种语言描述及 LaTeX，按所选语言加载本地语法模块。公式引擎为 KaTeX，不能视为与 Typora 的 MathJax 全部命令相同。

保存采用同目录临时文件后替换，保留 UTF-8 BOM。未编辑的打开文件、未编辑的源码往返保留原始文本；实际富文本编辑会将 Markdown 重新序列化，空白和标记形式可能规范化。源码模式编辑纯 CRLF 文档时保留 CRLF。支持相对本地图片；文档引用的远程图片会按其 URL 加载。

磁盘上的原文件如果被其他程序修改，保存前会提示另存为、明确覆盖或取消。当前单文档上限 16 MB，未完成大型文档性能验证。实时排版使用富文本节点，显示方式与 Typora 不完全相同；需要直接编辑全部 Markdown 标记时使用源码模式。

## 导出

点击「导出」，选择位置后生成文件。导出读取当前内容，包括尚未保存的修改，不会先保存或改写原 Markdown 文档。

- PDF：A4、A5 或 Letter；横向或纵向；0–50 毫米页边距；可选页码；沿用当前浅深外观和自定义 CSS。
- HTML：可包含当前样式，也可输出无样式 HTML；可选目录和标题跳转。无样式公式使用 MathML。
- 本地图片根据原文档目录解析；HTTP/HTTPS 图片保留链接。PDF 会等待图片和字体，图片失败或资源超时会报告错误。网络图片需要相应网络访问条件。
- 数学的 KaTeX 字体嵌入带样式 HTML。自定义主题中的其他字体、图片和导入 CSS 保持文件引用；HTML 不是所有资源都打包在一个文件中的离线归档，移动或分享时需处理这些资源路径。

使用 CSS 的 `@media print` 可单独控制 PDF。除安全下划线标记外，原始 HTML 当作文字处理，文档脚本不会执行。当前没有 DOCX/RTF、Pandoc 接入、系统打印或 Mermaid 渲染；PDF/HTML 的默认排版与编辑画面可能有细节差异。

## 自定义 CSS

「主题」→「打开主题目录」可进入个人主题文件夹。附带两份原创示例 `forest.css`、`book.css`。

把 CSS 放入主题目录后点「刷新」，选择并应用。也可用「导入 CSS…」；同名文件会自动换名，避免覆盖。导入会复制与 CSS 同名的相邻资源子目录，例如 `example.css` 和 `example/`；其他字体、图片或 CSS 资源需要自己放入主题目录。

支持 Typora 公开的常用约定，应用顺序为：灵书基础样式 → 当前主题 CSS → `base.user.css` → `主题名.user.css`。例如选择 `forest.css`，最后会读取 `forest.user.css`。修改文件后点「刷新」即可应用，不会自动监视目录。

正文根元素是 `#write.markdown-body`，可以在 `base.user.css` 写：

```css
#write { max-width: 850px; font-family: "Microsoft YaHei", sans-serif; }
#write h1 { color: #476a53; }
@media print { #write { font-size: 11pt; } }
```

常见相对 `url()`、`@import` 会按主题 CSS 所在目录解析。主题 CSS 单文件上限 1 MB；复杂 CSS 转义、编辑器专用控件选择器，以及全部第三方 Typora 主题的兼容性未验证。正文 DOM、代码和公式控件不同，已有主题可能需要调整。主题只需本地文件，不需要会员、卡密或联网激活。

## 反馈到 GitHub Issue

点击工具栏「反馈」，或原生「帮助 → 反馈」，填写问题或建议、标题及详细内容。目标固定为 [官方仓库的 Issues](https://github.com/Lingshu-Project/lingshu/issues)。不会自动附带当前文档、剪贴板、日志、文件路径、机器名或私人联系资料；只提交你填写的内容、类型和应用版本。Issue 内容和提交者的 GitHub 身份会公开，请在提交前检查内容。

- 「直接提交到 Issue」：使用提交者自己的 GitHub 访问令牌授权。令牌必须能对目标仓库创建 Issue；合适的细粒度令牌需 Issues 写入权限，令牌的资源所有者和仓库访问范围也必须包含目标仓库。GitHub 对外部贡献者的令牌类型有限制，无法访问目标仓库时可改用网页方式。令牌只用于这一次 HTTPS 请求，不保存到磁盘、配置或源码，请求开始后输入框立即清空。
- 「在 GitHub 网页提交」：不需要向灵书提供令牌，打开预填的 GitHub Issue 表单，登录后由你在网页完成最终提交。仅打开网页不会显示为 Issue 已创建。超出网页 URL 长度的内容会明确提示，不会悄悄截断。
- 创建成功后显示 Issue 编号，可以直接查看。若连接或响应中断导致结果无法确认，会提示先检查仓库已有 Issue，再决定是否重新提交；应用不会自动重试。

程序和安装包不包含项目维护者的 GitHub 令牌。项目使用组织来源署名，Git 提交使用项目名及不可投递的占位邮箱；GitHub 自身的 Issue、Release 和其他操作记录仍可能显示执行它们的账号，不能据此承诺账号完全匿名。

## Windows 安装包

在 [Releases](https://github.com/Lingshu-Project/lingshu/releases) 下载 `Lingshu-Setup-0.3.0-x64.exe`，安装到当前 Windows 用户，创建桌面和开始菜单的「灵书」入口及卸载程序。也可使用完整便携包。安装器未做商业代码签名，系统可能显示未知发布者。

升级前保存并正常关闭已有窗口。卸载器配置为保留应用数据；应用文件与文档存储分开，用户自己保存的 Markdown 文档不会作为程序文件删除。

## 源码构建

Node.js 22.12+（本次构建使用 26.4.0）：

```powershell
npm ci
npm run build
npm start
```

`npm test` 执行真实临时文件读写测试。`npm run verify:desktop` 启动实际 Electron 窗口验证编辑、源码往返、保存保护、CSS 覆盖和 PDF/HTML；原生文件选择框及确认按钮使用明确的测试替身，编辑器、IPC、文件系统、Chromium 导出及本地 HTTP 图片资源均真实运行。测试生成文件保存在项目 `output/verification`，不会修改用户现有文档。Windows 拼音 IME 候选交互、原生对话框手动操作及全新 Windows 机器仍需手动验收。

`npm run package:portable` 将当前构建和 Electron 运行文件复制到本工作目录的 `outputs`；目标目录已经存在时会停止，避免覆盖已有交付。

先 `npm run package:portable`，再 `npm run package:installer`，可使用固定的 electron-builder 26.17.0 生成每用户 NSIS 安装器。反馈服务组件测试中的 HTTP 和浏览器行为使用明确替身；真实 GitHub 创建结果需要另外在目标仓库验证，不能用这些测试代替。

## 来源与许可

界面、文档状态管理、Electron 文件交互和本项目代码独立实现。前期 REA 静态观察仅用于理解桌面编辑器的分层；未复制 Typora 的代码、素材、预编译业务文件或授权机制。

编辑核心使用 MIT 许可的 Milkdown / Crepe 7.22.3。Electron、Chromium 和其他依赖的许可证保留在便携包中，不受本项目分成条款改写。

自 0.3.0 起，原创新增与修改部分适用根目录 LICENSE 的自定义许可：累计商业化用户不超过 20,000 人时免分成；首次超过后，仅对触发时点之后产生的相关产品收入计提 20%，不追溯门槛前收入。分支、修改、分发和商业化均允许，但须保留项目来源及适用条款。0.2.0 等历史 MIT 授权继续有效，原文保存在 `licenses/legacy-0.2.0-MIT.txt`。这类含强制收入分成的许可不符合 [OSI 开源定义的免版税要求](https://opensource.org/osd)，因此本项目采用“源码公开”描述。
