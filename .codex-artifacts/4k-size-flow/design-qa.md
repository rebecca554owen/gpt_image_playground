# 4K 尺寸选择设计验收

- 参考图：`/var/folders/ms/gqbk9w054s1_rt_3md1n3ffw0000gn/T/codex-clipboard-af40b917-8601-42c5-b409-6793da19a692.png`
- 同状态对比图：`reference-comparison.jpg`
- 桌面端 4K 弹窗：`desktop-warning.jpg`
- 桌面端选中状态：`desktop-selected.jpg`
- 手机端 4K 弹窗：`mobile-warning.jpg`
- 手机端 4K 16:9 选中状态：`mobile-matched.jpg`
- 设置页自动模型路由：`settings-auto-routing.jpg`

## 验收结果

- 4K 卡片使用独立的金色高价视觉，并同时展示“推荐”和“10×”。
- 从 1K/2K 切换到 4K 时，会先出现强提醒弹窗。
- 数量为 3 时，弹窗及尺寸确认区均明确显示“每张 10×”和“约等于 30 张标准图费用”。
- 4K 确认后，费用提醒仍持续显示在尺寸摘要和主按钮中。
- 桌面端与 390×844 手机端均无裁切、遮挡或横向溢出。
- 设置页不再让用户手动选择 2K/4K 模型，改为展示尺寸到模型的自动映射。
- 参考图与实现图已在相同 4K、16:9、3840×2160 状态下合并对照，原有结构与视觉语言保持一致。

final result: passed
