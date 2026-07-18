# 新用户引导 Design QA

## 对照范围

- source visual truth: `/Users/qinxian/.codex/generated_images/019f5cd9-526b-7e50-8a84-6c36971a9a99/exec-7f78e33a-1166-4725-8331-6511241f96ba.png`
- implementation screenshot: `/tmp/onboarding-final-step2-1440x1024.png`
- desktop viewport: requested `1440 × 1024`, browser-rendered evidence `1429 × 1016`
- mobile viewport: requested `390 × 844`, browser-rendered evidence `379 × 820`
- state: 4 步引导中的第 2 步“作品胶片”，输入框已被聚光提示
- full-view comparison evidence: `/tmp/onboarding-design-qa-comparison-v1.png`，左侧为视觉方案，右侧为浏览器实现
- focused region comparison evidence: `/tmp/onboarding-design-qa-cta-focus-v1.png`，对照原方案的小购买链接与用户要求放大的购买 CTA

## Findings

- 无可执行的 P0、P1 或 P2 问题。
- 字体与排版：沿用现有 HarmonyOS Sans SC 字体栈；标题、正文、标签和辅助文字的字号、字重、行高与方案层级一致，无截断或异常换行。
- 间距与布局：桌面玻璃面板宽高、左右双栏比例、圆角、分隔线和垂直节奏与方案一致；购买 CTA 的扩大属于用户明确要求的有意偏离。
- 颜色与视觉 token：使用现有蓝色主色、半透明白色面板、深色遮罩和柔光阴影；文本和按钮对比度清晰。
- 图片质量与资产：三张示例图均为独立高分辨率真实栅格资产，主题分别覆盖文字生图、产品视觉和旧图上色；没有占位图、CSS 绘图或伪造图标。
- 文案内容：明确说明贵数智能算力平台、淘宝店和旺旺购买的 API Key 通用、共享原有余额、无需额外付费，并强调低成本生图。
- 图标：交互图标统一使用 Phosphor 图标库，尺寸和字重一致；关闭、外链、放大、鼠标指引均有可访问名称。
- 交互与状态：已验证步骤前进/后退、点击进度切换、写入示例提示词、示例图放大、Escape 关闭预览、完成引导、刷新后不重复弹出、从“操作指南”再次打开。
- 响应式：移动首屏能完整看到三张示例图、进度、主操作和醒目的购买 CTA；后续聚光步骤将引导面板限制在底部输入框上方，并允许面板内部滚动，无横向溢出。
- 可访问性：首步使用模态 dialog，聚光步骤改用允许操作真实输入控件的非模态 tour；大图预览有独立焦点循环与触发点恢复。全程提供可见 focus ring、图片 alt、44px 级触控目标和 reduced-motion 降级。

## Comparison History

- 第 1 轮发现：桌面首屏右上角的图片图标与关闭按钮发生视觉碰撞，属于 P2 图标与间距问题。证据：`/tmp/onboarding-step1-1440x1024.png`。
- 修复：移除重复的图片装饰图标，并为图片区标题预留关闭按钮空间。
- 修复后证据：`/tmp/onboarding-final-step1-1440x1024.png`，关闭按钮周围已无重叠，卡片右上区域干净。
- 第 2 轮发现：代码复查发现 2 个 P1 和 3 个 P2——大图预览焦点留在父层、聚光步骤的模态语义与真实输入交互冲突、IndexedDB 加载前可能误判老用户、矮屏桌面面板可能遮挡目标、移动进度圆点热区不足 44px。
- 修复：预览增加独立焦点循环并让父层 `inert`；聚光步骤改为非模态；等待 `initStore()` 完成后再判断新用户；面板高度同时扣除顶部偏移与输入栏占位；进度按钮热区扩大到 44px。
- 修复后证据：大图打开后焦点位于预览 dialog，Tab 进入关闭按钮，Escape 后回到原缩略图；写入示例提示词后焦点位于真实 prompt 且父层无 `aria-modal`；`1024 × 700` 矮屏下引导面板底部与输入目标顶部保留 33px 间距。
- 第 3 轮发现：无新的 P0、P1 或 P2；桌面全视图、购买 CTA 局部对照、移动端和矮屏浏览器检查通过。

## Primary Interactions Tested

- 4 步进度与前进/后退按钮
- 示例提示词写入真实输入框
- 3 张示例图点击放大与 Escape 关闭
- 大图预览 Tab 焦点循环与关闭后焦点恢复
- 输入框、上传按钮和生成按钮聚光定位
- 1024 × 700 矮屏下面板不遮挡聚光目标
- 等待 IndexedDB 初始化后再执行新用户判断
- 首次访问完成记录与刷新验证
- 操作指南中的“重新查看新手引导”
- 浏览器控制台错误检查：无 error 或 warning，仅 Vite/React 开发信息

## Implementation Checklist

- [x] 桌面方案与选定的图 2 对齐
- [x] 购买 API Key 入口放大并提高对比度
- [x] 新用户通用 Key、共享余额和无需额外付费说明
- [x] 图生图与旧照片改色示例
- [x] 鼠标滑动指引、聚光阴影和图片放大
- [x] 桌面与移动端浏览器验证

## Follow-up Polish

- P3：移动端第 2–4 步为了保持底部真实输入控件可见，需要在引导面板内纵向滚动；当前有清晰滚动条和完整键盘访问路径，可在后续迭代中再做更紧凑的移动专用文案。

## Open Questions

- 无。

final result: passed
