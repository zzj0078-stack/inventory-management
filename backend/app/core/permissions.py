"""权限清单与预置角色模板（唯一数据源）

权限码格式：模块:动作
命名约定：
  view    查看/列表
  add     新增
  edit    编辑
  delete  删除
  approve 审核
  receive 入库
  ship    出库
  cancel  作废
  print   打印
  export  导出
"""

# 分组定义：模块 -> (显示名, [权限])
PERMISSION_GROUPS = [
    ("dashboard", "首页", [
        ("dashboard:view", "查看首页"),
    ]),
    ("supplier", "供应商", [
        ("supplier:view", "查看供应商"),
        ("supplier:add", "新增供应商"),
        ("supplier:edit", "编辑供应商"),
        ("supplier:delete", "删除供应商"),
    ]),
    ("customer", "客户", [
        ("customer:view", "查看客户"),
        ("customer:add", "新增客户"),
        ("customer:edit", "编辑客户"),
        ("customer:delete", "删除客户"),
    ]),
    ("product", "商品", [
        ("product:view", "查看商品"),
        ("product:add", "新增商品"),
        ("product:edit", "编辑商品"),
        ("product:delete", "删除商品"),
        ("product:export", "导出商品"),
    ]),
    ("category", "商品分类", [
        ("category:view", "查看分类"),
        ("category:add", "新增分类"),
        ("category:edit", "编辑分类"),
        ("category:delete", "删除分类"),
    ]),
    ("purchase", "采购管理", [
        ("purchase:view", "查看采购单"),
        ("purchase:add", "新增采购单"),
        ("purchase:edit", "编辑采购单"),
        ("purchase:delete", "删除采购单"),
        ("purchase:approve", "审核采购单"),
        ("purchase:receive", "采购入库"),
        ("purchase:cancel", "作废采购单"),
        ("purchase:print", "打印采购单"),
        ("purchase:export", "导出采购单"),
    ]),
    ("purchase_return", "采购退货", [
        ("purchase_return:view", "查看采购退货"),
        ("purchase_return:add", "新增采购退货"),
        ("purchase_return:approve", "审核采购退货"),
        ("purchase_return:ship", "采购退货出库"),
        ("purchase_return:cancel", "作废采购退货"),
    ]),
    ("sales", "销售管理", [
        ("sales:view", "查看销售单"),
        ("sales:add", "新增销售单"),
        ("sales:edit", "编辑销售单"),
        ("sales:delete", "删除销售单"),
        ("sales:approve", "审核销售单"),
        ("sales:ship", "销售出库"),
        ("sales:cancel", "作废销售单"),
        ("sales:print", "打印销售单"),
        ("sales:export", "导出销售单"),
    ]),
    ("sale_return", "销售退货", [
        ("sale_return:view", "查看销售退货"),
        ("sale_return:add", "新增销售退货"),
        ("sale_return:approve", "审核销售退货"),
        ("sale_return:receive", "销售退货入库"),
        ("sale_return:cancel", "作废销售退货"),
    ]),
    ("inventory", "库存查询", [
        ("inventory:view", "查看库存"),
        ("inventory:export", "导出库存"),
    ]),
    ("warehouse", "仓库管理", [
        ("warehouse:view", "查看仓库"),
        ("warehouse:add", "新增仓库"),
        ("warehouse:edit", "编辑仓库"),
        ("warehouse:delete", "删除仓库"),
    ]),
    ("transfer", "库存调拨", [
        ("transfer:view", "查看调拨单"),
        ("transfer:add", "新增调拨单"),
        ("transfer:approve", "执行调拨"),
        ("transfer:cancel", "作废调拨单"),
    ]),
    ("stockcheck", "库存盘点", [
        ("stockcheck:view", "查看盘点单"),
        ("stockcheck:add", "新建盘点单"),
        ("stockcheck:approve", "审核调账"),
        ("stockcheck:cancel", "作废盘点单"),
    ]),
    ("stocklog", "出入库明细", [
        ("stocklog:view", "查看出入库明细"),
        ("stocklog:export", "导出出入库明细"),
        ("stocklog:init", "生成期初流水"),
    ]),
    ("finance", "财务管理", [
        ("finance:view", "查看收付款"),
        ("finance:add", "新增收付款"),
        ("finance:edit", "编辑收付款"),
        ("finance:delete", "删除收付款"),
        ("finance:export", "导出收付款"),
    ]),
    ("report", "报表统计", [
        ("report:view", "查看报表"),
        ("report:export", "导出报表"),
    ]),
    ("user", "用户管理", [
        ("user:view", "查看用户"),
        ("user:add", "新增用户"),
        ("user:edit", "编辑用户"),
        ("user:delete", "删除用户"),
        ("user:resetpwd", "重置密码"),
    ]),
    ("role", "角色权限", [
        ("role:view", "查看角色"),
        ("role:add", "新增角色"),
        ("role:edit", "编辑角色"),
        ("role:delete", "删除角色"),
    ]),
    ("log", "操作日志", [
        ("log:view", "查看操作日志"),
        ("log:export", "导出操作日志"),
    ]),
    ("system", "系统维护", [
        ("system:check", "数据自检"),
        ("system:fix", "自动修复"),
        ("system:print", "打印模板设置"),
    ]),
]


def all_permissions():
    """[(code, name, module)] 展平"""
    out = []
    for module, _label, perms in PERMISSION_GROUPS:
        for code, name in perms:
            out.append((code, name, module))
    return out


def group_labels():
    return {m: label for m, label, _ in PERMISSION_GROUPS}


# ---------------------------------------------------------------------------
# 预置角色
#   perms 里的 "mod:*" 表示该模块全部权限；"*" 表示全部
# ---------------------------------------------------------------------------

ALL_CODES = [c for c, _, _ in all_permissions()]


def _expand(patterns):
    """把 'purchase:*' / '*' 展开成具体权限码"""
    if patterns == ["*"]:
        return list(ALL_CODES)
    out = set()
    for p in patterns:
        if p.endswith(":*"):
            mod = p[:-2]
            out.update(c for c in ALL_CODES if c.startswith(mod + ":"))
        elif p in ALL_CODES:
            out.add(p)
    return sorted(out)


ROLE_TEMPLATES = [
    {
        "name": "admin",
        "label": "系统管理员",
        "description": "全部权限，含用户/角色/系统维护",
        "patterns": ["*"],
    },
    {
        "name": "manager",
        "label": "业务经理",
        "description": "业务全流程 + 审核，无系统管理",
        "patterns": [
            "dashboard:view",
            "supplier:*", "customer:*", "product:*", "category:*",
            "purchase:*", "purchase_return:*",
            "sales:*", "sale_return:*",
            "inventory:*", "warehouse:*", "transfer:*", "stockcheck:*", "stocklog:*",
            "finance:*", "report:*",
        ],
    },
    {
        "name": "sales",
        "label": "销售员",
        "description": "客户与销售业务，可建单不可审核",
        "patterns": [
            "dashboard:view",
            "customer:view", "customer:add", "customer:edit",
            "product:view", "category:view",
            "sales:view", "sales:add", "sales:edit", "sales:print",
            "sale_return:view", "sale_return:add",
            "inventory:view",
            "report:view",
        ],
    },
    {
        "name": "purchaser",
        "label": "采购员",
        "description": "供应商与采购业务，可建单不可审核",
        "patterns": [
            "dashboard:view",
            "supplier:view", "supplier:add", "supplier:edit",
            "product:view", "category:view",
            "purchase:view", "purchase:add", "purchase:edit", "purchase:print",
            "purchase_return:view", "purchase_return:add",
            "inventory:view",
            "report:view",
        ],
    },
    {
        "name": "warehouse",
        "label": "仓管员",
        "description": "库存、调拨、盘点、出入库；负责采购入库与销售出库",
        "patterns": [
            "dashboard:view",
            "product:view", "category:view",
            "inventory:*", "warehouse:*", "transfer:*", "stockcheck:*", "stocklog:*",
            "purchase:view", "purchase:receive",
            "purchase_return:view", "purchase_return:ship",
            "sales:view", "sales:ship",
            "sale_return:view", "sale_return:receive",
        ],
    },
    {
        "name": "finance",
        "label": "财务",
        "description": "收付款与报表，单据只读",
        "patterns": [
            "dashboard:view",
            "finance:*",
            "report:*",
            "supplier:view", "customer:view",
            "purchase:view", "purchase:export",
            "sales:view", "sales:export",
            "inventory:view", "inventory:export",
        ],
    },
    {
        "name": "viewer",
        "label": "只读用户",
        "description": "仅可查看，不能做任何修改",
        "patterns": [
            "dashboard:view",
            "supplier:view", "customer:view", "product:view", "category:view",
            "purchase:view", "purchase_return:view",
            "sales:view", "sale_return:view",
            "inventory:view", "warehouse:view", "transfer:view",
            "stockcheck:view", "stocklog:view",
            "finance:view", "report:view",
        ],
    },
]


def role_permission_codes(template):
    return _expand(template["patterns"])
