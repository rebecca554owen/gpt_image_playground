# Design QA

- Source visual truth: `/Users/qinxian/code/gpt_image_playground/.codex-artifacts/model-options-4k-selected.jpg`
- Desktop implementation screenshot: `/Users/qinxian/code/gpt_image_playground/.codex-artifacts/model-options-10x-4k-selected.jpg`
- Mobile implementation screenshot: `/Users/qinxian/code/gpt_image_playground/.codex-artifacts/model-options-10x-mobile.jpg`
- Focused comparison: `/Users/qinxian/code/gpt_image_playground/.codex-artifacts/model-options-10x-comparison.png`
- Desktop viewport: 1280 × 720
- Mobile viewport: 390 × 844
- State: API 配置弹窗，OpenAI 兼容接口，Images API；检查 1×/10× 费用标签及 2K、4K 选中态

**Findings**

- 未发现需要修复的 P0、P1 或 P2 问题。
- 字体与层级：沿用设置弹窗现有字号、字重和等宽模型名样式；2K/4K 标题、分辨率、费用倍率与状态标签层级清晰。
- 间距与布局：桌面端双列等宽，移动端单列堆叠；390px 视口下卡片范围为 37–353px，页面 `scrollWidth` 与视口同为 390px，无横向溢出。
- 颜色与状态：选中态沿用现有蓝色交互色，价格提示使用低饱和琥珀色；边框、圆角和深色模式类名与现有设置表单一致。
- 图片与资产：原始区域和新组件均不包含图片资产，无缺失或近似替代。
- 文案：2K 明确标记为“1× 基础费用”，4K 明确标记为“10× 费用”；说明区写明 4K 单张费用是 1K–2K 的 10 倍，并给出适用场景。

**Full-view comparison evidence**

- 桌面完整弹窗截图显示费用标签加入后，API 接口上下文和下方流式传输区未发生结构漂移。
- 聚焦对比图同时包含修改前后的双选卡片，确认费用倍率在卡片内可直接扫读，说明区也同步强化了 10× 计费信息。

**Focused region comparison evidence**

- 1× 标签采用中性灰色，10× 标签采用琥珀色，费用风险明显但没有压过模型选择主层级。
- 4K 选中态同时显示“推荐”“已选择”和“10× 费用”，模型 ID 完整可见；桌面与移动端提醒文案均未截断。

**Interaction and runtime checks**

- 初始 2K 选项为 `aria-checked="true"`。
- 点击 4K 后，带“10× 费用”的 `gpt-image-2-4k` 选项为 `aria-checked="true"`；随后已恢复默认 2K 状态。
- 浏览器控制台无错误。
- `npm run build` 通过；`npm test` 通过 22 个文件、249 项测试。

**Comparison history**

- 第 1 轮：未发现 P0/P1/P2 差异，无需返工循环。桌面与移动端均通过布局、状态、文案和交互检查。
- 第 2 轮：原设计仅提示 4K 价格更高，缺少明确倍率，可能导致费用预期错误。已在两张卡片加入 1×/10× 对比标签，并把说明改为精确的 10 倍计费规则；修改后桌面与移动端均无拥挤、截断或横向溢出。

**Implementation Checklist**

- [x] 2K 固定映射 `gpt-image-2`
- [x] 4K 固定映射 `gpt-image-2-4k`
- [x] 2K“1× 基础费用”与 4K“10× 费用”对比
- [x] 4K 推荐与 10 倍计费提醒
- [x] 桌面和移动端响应式布局
- [x] 键盘焦点与单选语义
- [x] 构建、测试与浏览器检查

**Follow-up Polish**

- 无阻塞性后续项。

final result: passed
