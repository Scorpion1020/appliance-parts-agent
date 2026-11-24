import { chineseContent } from "@/lib/zh-content";
// 只转换界面和程序生成的说明，不改接口字段、用户输入或来源引文。
const phrases: Record<string, string> = {
  "All configured free model quotas are exhausted.": "所有已配置模型的免费额度均已用尽，请补充额度或更换可用模型。",
  "Model request failed or timed out; no automatic retry.": "模型请求失败或超时，系统未自动重试。",
  "Model request failed or timed out after bounded retries.": "模型请求在有限重试后仍失败或超时，请稍后重试。",
  "Python Agent could not be reached or exceeded its time limit.": "智能体服务暂不可用或处理超时，请稍后重试。",
  "The cart service could not be reached. Refresh the cart before retrying an action.": "暂时无法连接购物车服务，请刷新确认状态后再重试。",
  "Execution lease expired; retry the same request.": "任务执行已过期，请点击重试并沿用原操作编号。",
  "Another turn is still running. Wait, then retry the same request.": "上一轮仍在执行，请稍后重试同一请求。",
  "Agent execution failed. Retry the same request.": "智能体执行失败，请点击重试同一请求。",
  "I can only help with refrigerator and dishwasher parts, installation, compatibility, troubleshooting, and order support.": "我可以帮助查询冰箱和洗碗机配件、安装、适配及故障排查，不提供其他领域服务。",
  "I can help if you share a part number, model number, appliance type, or the symptom you're seeing.": "请提供配件编号、设备型号、设备类型或故障现象。",
  "Please enter a part number, model number, or describe the appliance issue you'd like help with.": "请输入配件编号、设备型号，或描述需要解决的家电问题。",
  "I couldn't find that part in the catalog. Please check the part number or share a product description.": "目录中未找到该配件，请核对编号或补充配件描述。",
  "I couldn't find a matching part in the catalog. Try a part number, model number, or appliance description.": "目录中未找到匹配配件，请补充编号、型号或设备描述。",
  "This is a demonstration diagnostic checklist, not a verified diagnosis. Disconnect power/water before physical inspection and consult a qualified technician when unsure.": "以下是演示排查清单，不是经过核实的诊断。实际检查前请断电断水，不确定时请联系专业人员。",
  "Possible causes (unverified)": "可能原因（未经核验）",
  "broken refrigerator door bin": "冰箱门置物盒损坏", "cracked shelf bin": "置物盒开裂",
  "ice maker not working": "制冰机不工作", "no ice": "不制冰", "ice cubes are small": "冰块偏小",
  "no water": "不出水", "slow water flow": "水流缓慢", "poor cleaning": "清洗效果差",
  "dishes still dirty": "餐具仍有污渍", "spray arm broken": "喷淋臂损坏",
  "rack not rolling": "碗篮无法滑动", "rack falls off track": "碗篮脱轨", "rack wheel broken": "碗篮滚轮损坏",
  "This request is still running. Wait before retrying.": "请求仍在处理中，请稍等后再重试。",
  "This request failed. Retry with the same operation ID.": "请求失败，请点击重试以沿用原操作编号。",
  "Refrigerator Ice Maker Assembly": "冰箱制冰机组件",
  "Refrigerator Water Inlet Valve": "冰箱进水阀",
  "Dishwasher Rack Wheel": "洗碗机碗篮滚轮",
  "Door-mounted refrigerator storage bin. Verify the full model before ordering; the price shown is for this demonstration only.": "安装在冰箱门上的置物盒。购买前请核对完整型号；显示价格仅用于演示。",
  "Automatic ice maker assembly for compatible Whirlpool refrigerators.": "用于适配的惠而浦冰箱的自动制冰机组件。",
  "Controls water flow to the ice maker and dispenser in compatible refrigerators.": "控制适配冰箱中制冰机和饮水器的进水。",
  "Middle spray arm for model-specific dishwasher wash systems. Verify the complete model before ordering.": "用于指定型号洗碗机清洗系统的中层喷淋臂。购买前请核对完整型号。",
  "Replacement wheel that supports smooth movement of the dishwasher rack.": "用于更换洗碗机碗篮滚轮，使碗篮顺畅移动。",
  "Which exact part number would you like me to check?": "你想查询哪个配件？请提供完整配件编号。",
  "What is the complete refrigerator or dishwasher model number?": "请提供冰箱或洗碗机的完整型号。",
  "Which appliance and symptom would you like help with?": "你使用的是什么设备？出现了什么故障现象？",
  "I can help with refrigerator and dishwasher parts, compatibility, and maintenance. Please ask about one of those topics.": "我可以帮助查询冰箱和洗碗机配件、型号适配及维护方法，请围绕这些内容提问。",
  "No matching catalog product was found.": "当前目录中没有找到匹配配件。请核对编号，或补充配件描述。",
  "I found reviewed summaries of manufacturer guidance. These are general maintenance notes, not a diagnosis, a live-page check, or proof of parts compatibility. Read the source and your model's manual before acting.": "找到了经过审核的厂家指导摘要。这些是通用维护说明，不是故障诊断、实时页面核验或配件适配证明。操作前请阅读原始资料及对应型号的说明书。",
  "Please describe the maintenance topic or symptom you want to look up.": "请描述你想了解的维护问题或故障现象。",
  "The current knowledge collection has no matching evidence for this question. This does not prove that a fault or compatibility relationship is absent. Check the exact model's manual or contact the manufacturer.": "当前知识库没有找到匹配证据，但这不代表不存在该故障或适配关系。请核对完整型号的说明书，或联系厂家。",
  "The cart proposal was withdrawn because compatibility is unknown or conflicting. No cart change was made.": "适配证据未知或存在冲突，已撤回加购建议，购物车未修改。",
  "The saved proposal is unavailable. Ask for a new proposal.": "原加购建议已不可用，请重新生成建议。",
  "Later compatibility evidence blocks this proposal. Review the evidence and request a new proposal.": "后续适配证据不支持该建议，请查看证据后重新生成建议。",
  "The appliance or model context changed. Request a new proposal before confirming.": "设备或型号已变更，请重新生成建议后再确认。",
  "Current evidence no longer supports this proposal. Request a new compatibility check.": "当前证据已不支持该建议，请重新核对适配情况。",
  "Product availability or price changed. Request a new proposal before confirming.": "商品可购买状态或价格已变化，请重新生成建议后再确认。",
  "Confirm the full model label and verify fit with the manufacturer or supplier before buying.": "购买前请核对完整型号，并向厂家或供应商确认适配情况。",
  "Do not use this part for the specified model; find an explicitly supported replacement.": "请勿将此配件用于该型号，应查找有明确适配证据的替代配件。",
  "Confirm the complete model suffix and the supplier's current fit information before buying.": "购买前请核对完整型号后缀及供应商最新的适配信息。",
  " This includes a dated reviewed record, not a live fit guarantee.": "其中包含带审核日期的记录，并非实时适配保证。",
  "Demo catalog price: ": "演示目录价格：",
  ". Availability: ": "；库存状态：",
  ". This is not compatibility evidence.": "。这不能作为适配证据。",
  "Review before confirming: add ": "请核对后确认加购：",
  "Catalog unit price: ": "目录单价：",
  "No cart change has been made; this is not a compatibility guarantee.": "购物车尚未修改，此建议不代表适配保证。",
  "Refrigerator Door Shelf Bin": "冰箱门置物盒",
  "Dishwasher Middle Spray Arm": "洗碗机中层喷淋臂",
  "Catalog entry; verify details with the manufacturer.": "目录参考信息，具体规格请以厂家官方资料为准。",
  "Diagnostic Checklist": "故障排查清单",
  "Possible Causes": "可能原因",
  "Recommended Parts": "相关配件",
  "In stock": "有货", "Out of stock": "缺货", "Limited stock": "库存有限", "Unknown": "未知",
};

export function chineseText(text: string): string {
  if (chineseContent[text.trim()]) return chineseContent[text.trim()];
  let translated = text
    .replace(/^Confirm cart proposal .+$/, "确认之前的加购建议")
    .replace(/^Remove ([A-Z0-9-]+) from my cart$/, "从购物车移除 $1")
    .replace(/^Show my cart$/, "查看购物车")
    .replace(/^Prepare adding one ([A-Z0-9-]+) to my cart for confirmation$/, "为 $1 生成加购一件的建议，等待我确认")
    .replace(/Confirmed: added (\d+) × ([A-Z0-9-]+) to the cart\. No order or payment was made\./g, "已确认：购物车加入 $1 件 $2。未下单，也未付款。")
    .replace(/Added one ([A-Z0-9-]+) to your cart\./g, "已向购物车加入一件 $1。")
    .replace(/Removed ([A-Z0-9-]+) from your cart\./g, "已从购物车移除 $1。")
    .replace(/Got it — I'll use ([A-Z0-9-]+) for compatibility checks\./g, "好的，后续将使用 $1 型号核对适配情况。")
    .replace(/Reviewed\/verified evidence supports compatibility between (\S+) and model (\S+)\./g, "已审核/核验的证据支持配件 $1 与型号 $2 适配。")
    .replace(/Evidence indicates (\S+) is NOT compatible with model (\S+)\./g, "来源证据明确说明配件 $1 与型号 $2 不适配。")
    .replace(/Compatibility between (\S+) and model (\S+) is unknown due to conflicting evidence\./g, "配件 $1 与型号 $2 的来源证据存在冲突，适配情况未知。")
    .replace(/Compatibility between (\S+) and model (\S+) is unknown \(only unverified demonstration catalog data exists\)\./g, "仅演示目录关联了配件 $1 与型号 $2，真实适配情况未知。")
    .replace(/Compatibility between (\S+) and model (\S+) is unknown because no valid matching evidence was found\./g, "暂未找到配件 $1 与型号 $2 的有效适配证据，适配情况未知。")
    .replace(/The cited source supports compatibility between (\S+) and model (\S+)\./g, "引用来源支持配件 $1 与型号 $2 适配。")
    .replace(/An explicit source states that (\S+) and model (\S+) are not compatible\./g, "来源明确说明配件 $1 与型号 $2 不适配。")
    .replace(/The sources conflict about (\S+) and model (\S+); compatibility is unknown\./g, "配件 $1 与型号 $2 的来源证据存在冲突，适配情况未知。")
    .replace(/Only demonstration data links (\S+) and model (\S+); real compatibility is unknown\./g, "仅演示数据关联了配件 $1 与型号 $2，真实适配情况未知。")
    .replace(/I could not verify compatibility between (\S+) and model (\S+)\. Absence from a retrieved list does not prove incompatibility\./g, "暂无法核实配件 $1 与型号 $2 是否适配。检索列表未列出该型号，并不等于不适配。");
  for (const [original, chinese] of Object.entries(phrases)) translated = translated.split(original).join(chinese);
  return translated;
}

export function chineseStatus(status: string): string {
  return ({ compatible: "适配", incompatible: "不适配", unknown: "未知", found: "已找到", no_evidence: "未找到证据", insufficient_query: "需要补充问题", ok: "成功", error: "失败",
    refrigerator: "冰箱", dishwasher: "洗碗机", completed: "已完成", failed: "失败", running: "执行中",
    supported: "有适配证据", explicit_exclusion: "来源明确排除", conflicting_evidence: "证据冲突", demo_only: "仅有演示数据",
    live: "已获取页面", reviewed: "人工审核快照", demo: "演示数据", demo_seed: "演示数据",
    Whirlpool: "惠而浦",
    "In stock": "有货", "Limited stock": "库存有限", "Out of stock": "缺货", Unknown: "未核实"
  } as Record<string, string>)[status] ?? status;
}

export function chineseError(code: string, message: string): string {
  const errors: Record<string, string> = {
    model_not_configured: "模型服务尚未正确配置，请检查服务端设置。",
    model_free_quota_exhausted: "所有已配置模型的免费额度均已用尽，请补充额度或更换可用模型。",
    model_unavailable: "模型服务暂不可用，请稍后重试。",
    model_protocol_error: "模型未按要求返回工具操作，请重试或简化问题。",
    agent_step_limit: "本轮已达到执行步数上限，请缩小问题范围后重试。",
    agent_timeout: "本轮处理超时，请稍后重试。",
    backend_unavailable: "暂时无法连接后端，请稍后刷新会话。",
    python_agent_unavailable: "智能体服务暂不可用或超时，请稍后重试。",
    evidence_tool_unavailable: "证据查询暂不可用，系统未据此认定适配或加购成功。",
    cart_not_found: "原购物车已不存在，请重新加载会话。",
    cart_item_not_found: "购物车中没有该配件，请刷新查看当前状态。",
    insufficient_stock: "库存不足，请减少数量或移除该配件。",
    product_not_found: "目录中没有该配件，请核对编号。",
    product_unavailable: "该配件当前不可购买。",
    product_missing_price: "该配件尚无有效价格，暂不可加购。",
    conversation_busy: "上一轮仍在处理中，请稍后重试。",
    idempotency_conflict: "该操作编号已用于其他请求，请重新加载会话。",
    turn_expired: "任务已过期，请重试原请求。", turn_superseded: "会话已由其他任务更新，请重新加载。"
  };
  const translated = chineseText(message);
  return errors[code] ?? (/[\u3400-\u9fff]/.test(translated) ? translated : `请求未完成，请刷新会话后重试。错误标识：${code}`);
}
