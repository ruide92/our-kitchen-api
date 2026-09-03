# KRP v2 — Kitchen Recipe Import Protocol

状态：Normative / Phase 2 Freeze

KRP v2 用于把外部菜谱信息通过 ChatGPT、豆包或其他 AI 整理成小程序可校验、可预览、可编辑、可导入的家庭菜谱资产。KRP 不是“AI 自动写数据库”的接口；用户确认是入库前的最后一步。

## 1. 目标

典型流程：

`小红书/抖音/B站/网页/截图/文字 → AI + Recipe Skill → KRP v2 → 小程序 parse → validate → preview/edit → confirm → Family Recipe`

协议同时服务：

- 菜名与基础属性提取
- 主料/配菜/调味/装饰料结构化
- 步骤拆分、火力、时间、成熟判断
- 替代食材与防失败提示
- 口味、餐次、厨具、营养标签
- 来源与 AI 推断可追溯
- 封面/步骤图的未来资产位与生成提示词

## 2. 包装格式

兼容人工复制粘贴，推荐输出：

```text
<KITCHEN_RECIPE_PACK version="2.0">
{ ...strict JSON... }
</KITCHEN_RECIPE_PACK>
```

解析器也可接受纯 JSON，但正式 Recipe Skill 默认输出 wrapper + 单个 JSON object。

JSON 外不得混入解释、Markdown code fence 或第二个对象。

`schema_version` 固定：`"2.0"`。

## 3. 顶层结构

```json
{
  "schema_version":"2.0",
  "source":{},
  "recipe":{},
  "ingredients":[],
  "steps":[],
  "nutrition":{},
  "media":{},
  "import_meta":{}
}
```

必需：`schema_version, source, recipe, ingredients, steps, import_meta`。

`nutrition/media` 可为空对象，但字段类型必须正确。

## 4. source

```json
{
  "platform":"XIAOHONGSHU|DOUYIN|BILIBILI|WECHAT|WEB|IMAGE|TEXT|OTHER",
  "url":null,
  "title":"原内容标题（能确认时）",
  "author":"原作者/账号（能确认时）",
  "captured_text":null,
  "note":null
}
```

规则：

- 不知道就 null，禁止猜作者、URL、标题。
- `captured_text` 只保存完成菜谱整理所需的简短来源摘录/用户输入，不要求复制完整受版权保护原文。
- 来源链接仅用于溯源，不把第三方防盗链图片当小程序长期正式资产。

## 5. recipe

```json
{
  "name":"辣椒炒肉",
  "aliases":[],
  "description":"家常小炒，香辣下饭",
  "cuisine_code":"HUNAN",
  "category_code":"HOT_DISH",
  "meal_types":["LUNCH","DINNER"],
  "base_servings":2,
  "cook_time_minutes":20,
  "difficulty":2,
  "spiciness":3,
  "sweetness":null,
  "saltiness":2,
  "sourness":null,
  "oiliness":2,
  "cookware":["WOK"],
  "cooking_method_code":"STIR_FRY",
  "protein_source_code":"PORK",
  "vegetable_category_codes":["PEPPER"],
  "tags":["HOME_STYLE","QUICK"],
  "allergens":[],
  "suggested_kiss":4
}
```

约束：

- 五种口味 0–5 或 null。
- difficulty 1–5。
- `suggested_kiss` 为非负整数/可 null，只是家庭互动建议，不是价格。
- 不输出 `health_score/healthiness/kiss_reward/spicy_level/equipment` 等旧字段。

## 6. ingredients

每项：

```json
{
  "name":"五花肉",
  "canonical_name":"五花肉",
  "canonical_code":null,
  "quantity":200,
  "quantity_text":null,
  "unit_code":"g",
  "type":"MAIN",
  "required":true,
  "alternatives":[
    {"name":"前腿肉","canonical_name":"猪前腿肉","canonical_code":null,"note":"更瘦"}
  ],
  "note":"切薄片"
}
```

`type`：`MAIN | SIDE | SEASONING | GARNISH`。

规则：

- AI 可判断 canonical_name，但除非已知本项目标准字典 code，否则 `canonical_code=null`，不得编造 code。
- 数值明确则 `quantity`；“少许/适量”写 `quantity=null, quantity_text="适量"`。
- 原内容未给精确量、AI 为可执行性补全的 quantity 必须列入 `import_meta.inferred_fields`。
- optional 调料用 `required=false`；用户随后删除的配料导入后不应由基础版本再次补回。
- 单位优先：`g, kg, jin, ml, l, piece, root, clove, spoon, pinch, appropriate`；未知单位允许原始字符串进入 `quantity_text/note`，由预览页确认。

## 7. steps

```json
{
  "step":1,
  "title":"处理五花肉",
  "operation":"五花肉切成约 2–3 mm 薄片。",
  "duration_seconds":120,
  "duration_text":null,
  "heat_code":"NO_HEAT",
  "doneness_cue":null,
  "tip":"尽量厚薄一致，避免成熟度差异。",
  "media":{
    "source_image_url":null,
    "source_frame_note":null,
    "image_prompt":"真实家庭厨房手机摄影风格……"
  }
}
```

规则：

- `step` 从 1 连续递增。
- `heat_code`：`NO_HEAT | LOW | MEDIUM_LOW | MEDIUM | MEDIUM_HIGH | HIGH | CUSTOM | null`。
- 时间不确定可用 `duration_text`，不要伪造秒数。
- 涉及“炒熟即可”时尽可能从来源或常识补充可观察的 `doneness_cue`，若为 AI 补全则标 inferred。
- `tip` 是关键技巧/防失败，不要求每步都有。

## 8. nutrition

```json
{
  "status":"TAG_ONLY",
  "basis_servings":2,
  "calories_kcal":null,
  "protein_g":null,
  "fat_g":null,
  "carbs_g":null,
  "fiber_g":null,
  "sodium_mg":null,
  "calcium_mg":null,
  "iron_mg":null,
  "potassium_mg":null,
  "nutrition_tags":["PROTEIN_SOURCE","VEGETABLE_INCLUDED"],
  "traditional_diet_tags":[],
  "source_note":"未获得可靠营养数据库，仅提供结构化标签"
}
```

`status`：`UNKNOWN | TAG_ONLY | ESTIMATED | VERIFIED_SOURCE`。

规则：

- AI 无可靠数据库时不得为了“完整”编精确 kcal/g/mg。
- 若 AI 根据标准食材数据库进行了估算，必须 `status=ESTIMATED` 且在 source_note 说明方法。
- “滋阴/温补/清热”等只能进入 `traditional_diet_tags`，不能冒充现代营养数值；不得输出疾病治疗、壮阳、降糖等医疗功效宣称。

## 9. media

```json
{
  "cover":{
    "source_image_url":null,
    "asset_url":null,
    "image_prompt":"真实家常菜成品照……"
  },
  "step_images":[]
}
```

规则：

- KRP 可以携带来源 URL 用于人工参考，但导入时不保证长期保存/代理第三方图片。
- `asset_url` 只用于已经属于本系统/用户合法上传的持久资产。
- 第一版没有图片时允许仅保存 `image_prompt`。

## 10. import_meta

```json
{
  "ai_model":"model name if known",
  "generated_at":"2026-09-03T13:00:00Z",
  "inferred_fields":[
    {"path":"/ingredients/2/quantity","reason":"原内容只说少量生抽，为可执行性估为10ml","confidence":"LOW"}
  ],
  "uncertain_fields":[
    {"path":"/recipe/base_servings","reason":"原内容未明确人数","confidence":"LOW","candidates":[2,3]}
  ],
  "warnings":[]
}
```

path 使用 JSON Pointer。

confidence：`LOW | MEDIUM | HIGH`。

规则：

- **原内容明确给出** 与 **AI 推断** 必须可区分。
- 不确定且影响明显的字段进入 uncertain_fields，在预览页突出。
- `generated_at` 不知道时由小程序 parse 服务补充，不让 AI 猜时间。

## 11. 校验级别

解析服务返回：

- `errors`：不能导入，必须修复。例如 JSON 无效、无菜名、ingredients/steps 类型错误。
- `warnings`：允许继续预览。例如无封面、营养只有标签。
- `inferred_fields`：必须展示提示但不阻塞。
- `uncertain_fields`：按严重程度要求用户确认。

只有 `status=VALIDATED` 才允许 confirm。

## 12. 语义校验

至少检查：

1. schema_version = 2.0。
2. recipe.name 非空。
3. base_servings >=1。
4. 口味 0–5。
5. ingredients 至少 1 项。
6. ingredient type 合法。
7. quantity 非负；quantity=null 时应有 quantity_text 或允许“无需定量”的明确语义。
8. steps 至少 1 步且 step 顺序可规范化。
9. 对高风险不确定量（如明显单位错位）给 warning/error。
10. canonical ingredient 低置信度匹配不得静默绑定错误 ingredient_id。

## 13. 预览页要求

导入后必须先展示：

- 菜名/属性
- 主料/配菜/调味/装饰料
- 每一步做法
- AI 推断字段数量
- 不确定字段
- 图片/图片 Prompt 状态
- 营养状态

用户可以编辑所有家庭菜谱字段，尤其是：数量、是否需要糖/调料、火力、步骤、人数、口味。

确认入库后创建 `recipes.kind=FAMILY, source_type=KRP_IMPORT`。

## 14. Recipe Skill 未来必须遵守的行为

`skills/kitchen-recipe-import/SKILL.md` 实现时必须：

1. 先忠实提取来源明确内容，再做可执行性补全。
2. 不伪造作者、精确用量、营养数值或来源事实。
3. 所有补全写入 inferred_fields。
4. 输出机器可解析的单个 KRP v2。
5. 优先中国家庭厨房常用单位，但不强行把“个/瓣/少许”换成克。
6. 允许不同家庭口味差异；不把糖、辣椒等非必需调味描述成不可删除的硬依赖。
7. 生成步骤时优先“操作 + 火力 + 时间/状态 + 防失败”。
8. 可生成 cover/step image prompts，但不能假装已经生成图片。
9. 外部链接内容不可访问或信息不足时明确 uncertain，不脑补成“来自原视频”。

## 15. 示例最小合法包

```text
<KITCHEN_RECIPE_PACK version="2.0">
{"schema_version":"2.0","source":{"platform":"TEXT","url":null,"title":null,"author":null,"captured_text":null,"note":null},"recipe":{"name":"番茄炒蛋","aliases":[],"description":null,"cuisine_code":null,"category_code":"HOT_DISH","meal_types":["LUNCH","DINNER"],"base_servings":2,"cook_time_minutes":15,"difficulty":1,"spiciness":0,"sweetness":1,"saltiness":2,"sourness":1,"oiliness":1,"cookware":["WOK"],"cooking_method_code":"STIR_FRY","protein_source_code":"EGG","vegetable_category_codes":["FRUIT_VEGETABLE"],"tags":[],"allergens":["EGG"],"suggested_kiss":2},"ingredients":[{"name":"番茄","canonical_name":"西红柿","canonical_code":null,"quantity":2,"quantity_text":null,"unit_code":"piece","type":"MAIN","required":true,"alternatives":[],"note":null},{"name":"鸡蛋","canonical_name":"鸡蛋","canonical_code":null,"quantity":3,"quantity_text":null,"unit_code":"piece","type":"MAIN","required":true,"alternatives":[],"note":null}],"steps":[{"step":1,"title":"准备","operation":"番茄切块，鸡蛋打散。","duration_seconds":180,"duration_text":null,"heat_code":"NO_HEAT","doneness_cue":null,"tip":null,"media":{"source_image_url":null,"source_frame_note":null,"image_prompt":null}}],"nutrition":{"status":"TAG_ONLY","basis_servings":2,"calories_kcal":null,"protein_g":null,"fat_g":null,"carbs_g":null,"fiber_g":null,"sodium_mg":null,"calcium_mg":null,"iron_mg":null,"potassium_mg":null,"nutrition_tags":["PROTEIN_SOURCE","VEGETABLE_INCLUDED"],"traditional_diet_tags":[],"source_note":null},"media":{"cover":{"source_image_url":null,"asset_url":null,"image_prompt":null},"step_images":[]},"import_meta":{"ai_model":null,"generated_at":null,"inferred_fields":[],"uncertain_fields":[],"warnings":[]}}
</KITCHEN_RECIPE_PACK>
```

## 16. 兼容策略

旧 KRP v1/占位文本不得直接视为 v2。若未来需要兼容，单独写 migration parser 将旧 payload 转为 v2 preview，并明确 `warnings`；核心数据库只接受规范化后的 V2 数据。
