import type { ConversationState } from "@/lib/types";
import { chineseText, chineseStatus } from "@/lib/zh";

// 使用纯文本并缩进外部内容，避免把用户原话或网页摘要当成报告指令。
function quoted(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n").map((line) => "    " + line).join("\n");
}

export function buildHandoffReport(state: ConversationState, generatedAt = new Date()): string {
  const lines = [
    "售后交接记录 / Support handoff",
    "生成时间：" + generatedAt.toISOString(),
    "范围：当前会话最近 " + state.turns.length + " 轮记录（最多 40 轮），不是完整历史。",
    "重要：本文件不是维修诊断、兼容性保证或订单；演示目录不代表实时价格和库存。",
    "包含用户原话，请检查个人信息后再自行分享。系统不会自动发送此文件。",
    "",
    "一、当前登记信息",
    "设备类型：" + chineseStatus(state.memory.applianceType ?? "未登记"),
    "型号：" + (state.memory.currentModelNumber ?? "未登记"),
    "已选配件：" + (state.memory.selectedPart ?? "未登记"),
    "以上登记信息用于对话上下文，不等于已验证型号或适配关系。",
    "",
    "二、处理记录与依据"
  ];
  if (!state.turns.length) lines.push("暂无处理记录。");
  for (const [index, turn] of state.turns.entries()) {
    lines.push("", "记录 " + (index + 1) + " · " + chineseStatus(turn.status),
      "用户原话：", quoted(turn.message));
    const response = turn.response;
    if (turn.status !== "completed") lines.push("未完成：" + chineseText(turn.error ?? "任务仍在执行；稍后重新导出。"));
    if (!response) continue;
    lines.push("系统记录：", quoted(chineseText(response.message)));
    for (const fit of response.compatibilities ?? (response.compatibility ? [response.compatibility] : [])) {
      lines.push("适配判断：" + fit.partNumber + " / " + fit.modelNumber + " · " + chineseStatus(fit.status),
        "原因：" + chineseStatus(fit.reason), "后续建议：", quoted(chineseText(fit.nextAction)));
      for (const evidence of fit.evidence) lines.push("适配证据（" + chineseStatus(evidence.source.origin ?? "未标明来源类型") + "）：",
        quoted(evidence.excerpt), "来源：" + evidence.source.url);
    }
    for (const search of response.knowledge ?? []) {
      lines.push("知识检索：" + chineseStatus(search.status) + " · 索引版本 " + search.indexVersion);
      for (const hit of search.hits) lines.push(
        "资料：" + chineseText(hit.title) + " / " + chineseText(hit.heading),
        "整理摘要（不是原文引用或实时结果）：", quoted(chineseText(hit.summary)),
        "适用范围：", quoted(chineseText(hit.scope)), "安全提示：", quoted(chineseText(hit.safety)),
        "原始英文摘要（便于核对）：", quoted(hit.summary),
        "来源：" + hit.sourceUrl, "复核日期：" + hit.reviewedAt,
        "片段：" + hit.chunkId, "文档版本：" + hit.documentVersion
      );
    }
    for (const source of response.sources ?? []) lines.push(
      "参考来源（" + chineseStatus(source.origin ?? "未标明来源类型") + "）：" + source.title,
      quoted(source.url)
    );
    if (response.steps?.length) lines.push("记录中的操作步骤（执行前核对厂家说明）：", ...response.steps.map(step => quoted(chineseText(step))));
    for (const section of response.sections ?? []) lines.push(chineseText(section.title) + "：", ...section.items.map(item => quoted(chineseText(item))));
    for (const step of response.trace ?? []) lines.push(
      "执行步骤：" + step.tool + " · " + chineseStatus(step.status) + " · " + step.elapsedMs + " ms",
      ...(step.error ? ["错误：", quoted(chineseText(step.error))] : [])
    );
    if (response.cart) lines.push("本轮涉及演示购物车，不代表已付款、下单或安排维修。");
  }
  lines.push("", "三、人工接手时需确认",
    "核对设备完整型号、实际症状、现场安全条件和厂家适用说明。",
    "unknown 或 no_evidence 只表示当前证据不足，不表示配件不兼容或故障不存在。",
    "失败/执行中记录不能视作操作成功；如涉及购物车，请先查看当前状态再重试。",
    "报告不会自动识别故障原因，也不根据旧查询结果推荐立即购买。", "");
  return lines.join("\n");
}
