"""Fixed synthetic business corpus. No production text or identifiers are stored here."""

# ruff: noqa: RUF001

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Scenario:
    case_id: str
    category: str
    prompt: str
    expected_type: str
    expected_action: str | None = None
    source_kind: str = "TURN"
    candidate_mode: str = "NONE"
    incremental: bool = False


def _prompts(text: str) -> list[str]:
    return [line.strip() for line in text.strip().splitlines() if line.strip()]


GROUPS: tuple[tuple[str, str, str | None, str, bool, list[str]], ...] = (
    (
        "REPLY",
        "REPLY",
        None,
        "NONE",
        False,
        _prompts("""
        请用一句话说说如何安排上午工作。
        解释一下项目和待办有什么区别。
        我没有要求你创建任务，只想听时间管理建议。
        “删除所有任务”是别人说的话，请解释为什么要谨慎。
        先告诉我优先级高、中、低各代表什么。
        今天有点忙，给一个简短的专注建议。
        你能做哪些待办整理工作？只介绍能力。
        不要修改任何数据，概括一下制定计划的步骤。
        """),
    ),
    (
        "CLARIFICATION",
        "CLARIFICATION",
        None,
        "ONE",
        False,
        _prompts("""
        帮我改一下任务，但我还没说改哪一项。
        请创建一个任务，我还没想好标题。
        把某个任务的时间改一下，我稍后告诉你是哪一个。
        帮我删除一项待办，具体哪项待会儿再说。
        建一个项目，我还没有确定项目名称。
        把那个东西安排到下周，我没说是任务还是项目。
        我想完成一个任务，但还没告诉你任务名。
        给某项待办加提醒，我稍后补充对象和时间。
        请修改任务描述，先问我具体改哪项和改成什么。
        帮我把某项任务归到项目里，我还没说目标项目。
        """),
    ),
    (
        "CANDIDATES",
        "CANDIDATES",
        None,
        "AMBIGUOUS",
        False,
        _prompts("""
        把周报标记完成。
        把周报的标题改为本周总结。
        删除周报这个任务。
        给周报设置明天提醒。
        把周报改为高优先级。
        将周报恢复为待完成。
        把周报安排到下周一。
        清空周报的截止时间。
        给周报添加描述：已完成本周总结。
        把周报移到工作项目。
        """),
    ),
    (
        "PLAN",
        "PLAN",
        None,
        "PROJECT",
        False,
        _prompts("""
        为一次产品评审生成三项具体准备任务。
        把周末露营拆成五个可执行步骤。
        为明天的面试准备列一个简短计划。
        给学习 Python 制定四项待办。
        规划一次两小时的家庭大扫除。
        把发布新版本拆成测试、文档、发布三个步骤。
        为季度复盘生成清晰的任务清单。
        给一周健身安排列出可执行任务。
        为团队会议生成会前准备计划。
        规划一次小型生日聚会的准备事项。
        为搬家前的物品整理列出步骤。
        给阅读一本书制定四项跟进行动。
        为周五客户演示列出三项准备任务。
        把旅行前的证件、交通、住宿准备拆开。
        为写技术分享稿生成从提纲到排练的计划。
        为一次线上访谈生成预约、提纲、记录任务。
        """),
    ),
    (
        "CREATE_TASK",
        "ACTION_PROPOSAL",
        "CREATE_TASK",
        "PROJECT",
        False,
        _prompts("""
        创建一个标题为买牛奶的无项目待办。
        新建待办：周五写周报，优先级高。
        创建任务“检查合同😀”，保持默认优先级。
        添加一个不设置时间的任务：整理书桌。
        创建任务“给客户回邮件”，归入工作项目。
        建一个明天上午九点开始的任务：准备会议。
        添加“预订车票”，截止时间设为下周五。
        创建一个提醒我明天八点喝水的任务。
        """),
    ),
    (
        "CREATE_PROJECT_TASKS",
        "ACTION_PROPOSAL",
        "CREATE_PROJECT_TASKS",
        "PROJECT",
        False,
        _prompts("""
        新建露营项目，并创建准备帐篷和购买食材两项任务。
        创建搬家项目，加入打包和联系搬家公司。
        建一个读书项目，并添加选书与写笔记。
        为产品发布新建项目，同时创建测试、文档、公告三项任务。
        新建旅行项目并列出订票和订酒店两项待办。
        在现有工作项目下批量创建周报和复盘两项任务。
        新建健身项目，添加热身、跑步、拉伸三项待办。
        建家庭项目，同时添加缴费和采购两项任务。
        """),
    ),
    (
        "ORGANIZE_TASKS",
        "ACTION_PROPOSAL",
        "ORGANIZE_TASKS",
        "ORGANIZE",
        True,
        _prompts("""
        整理待办，只补缺少的项目归属。
        整理待办，只建议缺失的计划时间。
        整理待办，只补缺失的提醒时间。
        为待整理任务同时建议项目和计划时间。
        为待整理任务同时建议计划时间和提醒。
        为待整理任务补齐项目、计划时间和提醒。
        只整理当前项目内缺少时间的任务。
        不要覆盖已有提醒，整理其他缺失字段。
        给没有项目的待办建议合适归属，已有项目保持不变。
        最多提出二十项待确认的整理建议。
        """),
    ),
    (
        "UPDATE_TASK",
        "ACTION_PROPOSAL",
        "UPDATE_TASK",
        "ONE",
        False,
        _prompts("""
        把周报改名为本周工作总结。
        将周报描述改为列出本周三个成果。
        把周报优先级调高。
        把周报优先级改为低。
        把周报移动到工作项目。
        清空周报的项目归属。
        给周报设置明天上午九点的计划时间。
        清空周报的计划时间。
        把周报截止时间设为下周五下午六点。
        清空周报的截止时间。
        给周报设置明天八点的提醒。
        清空周报的提醒时间。
        同时将周报改名为本周总结，优先级改为高。
        同时把周报移到工作项目，计划时间改为明天九点，提醒改为明天八点。
        """),
    ),
    (
        "COMPLETE_TASK",
        "ACTION_PROPOSAL",
        "COMPLETE_TASK",
        "ONE",
        False,
        _prompts("""
        把周报标记完成。
        完成周报这项待办。
        我已写好周报，请把它完成。
        将周报从待完成移到已完成。
        只完成周报，不改其他任务。
        给周报生成待确认的完成操作。
        """),
    ),
    (
        "RESTORE_TASK",
        "ACTION_PROPOSAL",
        "RESTORE_TASK",
        "COMPLETED",
        False,
        _prompts("""
        把已完成的周报恢复为待办。
        周报还没结束，请撤销完成状态。
        将周报从已完成移回待完成。
        恢复周报任务，不要新建副本。
        我需要继续处理周报，把它标回待完成。
        给周报生成待确认的恢复操作。
        """),
    ),
    (
        "DELETE_TASK",
        "ACTION_PROPOSAL",
        "DELETE_TASK",
        "ONE",
        False,
        _prompts("""
        删除周报这项任务。
        把周报移入删除状态。
        周报不用做了，请删除它。
        只删除周报，不碰其他待办。
        为周报生成待确认的软删除操作。
        把周报从列表移除，保留撤销机会。
        """),
    ),
)


MULTITURN: tuple[tuple[str, str, str | None, str], ...] = (
    ("刚才创建的周报改成高优先级。", "ACTION_PROPOSAL", "UPDATE_TASK", "ONE"),
    ("把刚才那项任务标记完成。", "ACTION_PROPOSAL", "COMPLETE_TASK", "ONE"),
    ("刚才完成的周报恢复为待完成。", "ACTION_PROPOSAL", "RESTORE_TASK", "COMPLETED"),
    ("删除刚才讨论的周报。", "ACTION_PROPOSAL", "DELETE_TASK", "ONE"),
    ("上一轮的周报加上明早提醒。", "ACTION_PROPOSAL", "UPDATE_TASK", "ONE"),
    ("把那项周报移到工作项目。", "ACTION_PROPOSAL", "UPDATE_TASK", "ONE"),
    ("根据刚才的评审建议生成三项计划。", "PLAN", None, "PROJECT"),
    ("把刚才的计划任务缩减为两项。", "PLAN", None, "PROJECT"),
    ("回答上一轮的问题：选择工作项目。", "PLAN", None, "PROJECT"),
    ("我补充一下，目标是周五完成产品评审。", "PLAN", None, "PROJECT"),
    ("上一轮提到的任务是什么？只回答，不修改。", "REPLY", None, "ONE"),
    ("解释一下刚才计划中的优先级，不执行操作。", "REPLY", None, "PROJECT"),
    ("继续修改周报的截止时间为明天。", "ACTION_PROPOSAL", "UPDATE_TASK", "ONE"),
    ("把刚才创建的周报说明改短一些。", "ACTION_PROPOSAL", "UPDATE_TASK", "ONE"),
    ("请在新会话里创建待办：给客户回信。", "ACTION_PROPOSAL", "CREATE_TASK", "NONE"),
    ("当前项目是工作，只给周报补明天八点的提醒。", "ACTION_PROPOSAL", "UPDATE_TASK", "ONE"),
    ("同名周报有两项，先让我选要处理哪项。", "CANDIDATES", None, "AMBIGUOUS"),
    ("把刚才讨论的评审目标重新拆成四项任务。", "PLAN", None, "PROJECT"),
)


def scenarios() -> list[Scenario]:
    result: list[Scenario] = []
    for category, result_type, action, mode, incremental, prompts in GROUPS:
        for number, prompt in enumerate(prompts, 1):
            result.append(
                Scenario(
                    f"{category}-{number:02d}",
                    category,
                    prompt,
                    result_type,
                    action,
                    "ORGANIZE"
                    if category == "ORGANIZE_TASKS"
                    else "PLAN"
                    if category == "PLAN"
                    else "TURN",
                    mode,
                    incremental,
                )
            )
    for number, (prompt, result_type, action, mode) in enumerate(MULTITURN, 1):
        result.append(
            Scenario(
                f"MULTITURN-{number:02d}",
                "MULTITURN",
                prompt,
                result_type,
                action,
                "PLAN" if result_type == "PLAN" else "TURN",
                mode,
            )
        )
    if len(result) != 120 or len({case.case_id for case in result}) != 120:
        raise ValueError("Synthetic corpus must contain 120 distinct cases")
    return result
