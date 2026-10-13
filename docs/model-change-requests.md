# 模型数据修改需求（同步到清霄模型制作仓库）

petsking 接入清霄时发现的、更适合在模型 / 素材侧修正的问题。代码里目前有对应的兜底处理，
模型侧修好后可以删掉兜底。每条：现象 → 期望 → 代码兜底位置。

| # | 日期 | 对象 | 现象 | 期望 | 代码兜底 |
|---|---|---|---|---|---|
| 1 | 2026-10-13 | 材质 Down / Cloth | glTF 标为 `MASK`，但 base color 的 alpha 通道是无意义的低值数据（均值 ~0.18），按 MASK 渲染会挖出大洞 | 导出为 `OPAQUE`，或清空 alpha 通道 | `_gltf-character.js` `fixMaterials()` 强制不透明 |
| 2 | 2026-10-13 | 材质 Bangs / Hair | glTF 标为 `OPAQUE`，但 alpha 是真实的发丝镂空 | 导出为 `MASK`、`alphaCutoff≈0.35`、`doubleSided: true` | `fixMaterials()` 设 alphaTest 0.35 + DoubleSide |
| 3 | 2026-10-13 | 全部动画 | `Root` 骨骼带 translation 轨道，循环边界会跳 | 导出原地动画（去掉 Root.position），位移速度写进清单 | `Character` 构造时过滤 `Root.position` 轨道 |
| 4 | 2026-10-13 | 场景单位 | 模型以 cm 制作，需要在代码里 `scale 0.01` | 导出时换算到米 | `Character` 构造时 `root.scale.setScalar(0.01)` |
| 5 | 2026-10-13 | 动画库 | 只有待机/小动作/走/跑，Agent 状态只能靠表情 + 程序化头部手势区分 | （后续）补 挥手 / 欢呼 / 思考托腮 / 敲键盘 等上身 clip | 无，加 clip 后只改 `pets/qingxiao/pet.json` |
