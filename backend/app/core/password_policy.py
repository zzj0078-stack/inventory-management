"""密码强度策略（唯一事实来源）

规则：
    1. 长度 8 - 64 位
    2. 至少 1 个特殊字符（! @ # $ % ^ & * 等）
    3. 不含空格、制表符等空白字符

前端 frontend/src/utils/password.js 与之保持一致（仅用于即时提示，
真正生效的是本模块 —— 所有写入密码的接口都必须调用 validate_password）。
"""
import string
from typing import Optional

MIN_LENGTH = 8
MAX_LENGTH = 64

# 特殊字符：ASCII 可见标点 + 常见全角/中文标点
ASCII_SPECIAL = set(string.punctuation)
UNICODE_SPECIAL = set("！？。，、；：“”‘’（）【】《》—…·￥±×÷≤≥≠∞§¶†‡•‰′″‹›«»–¡¿")
SPECIAL_CHARS = ASCII_SPECIAL | UNICODE_SPECIAL

RULES_TEXT = "至少 8 位，需含至少 1 个特殊字符（如 ! @ # $ % ^ & *），不能有空格"


def special_chars_in(password: str):
    """返回密码中出现过的特殊字符集合"""
    return {c for c in password if c in SPECIAL_CHARS}


def validate_password(password) -> Optional[str]:
    """校验密码强度。

    返回 None 表示通过；否则返回中文错误提示。
    """
    if password is None:
        return "请输入密码"

    if not isinstance(password, str):
        return "密码格式不正确"

    if password == "":
        return "请输入密码"

    if len(password) < MIN_LENGTH:
        return f"密码至少 {MIN_LENGTH} 位（当前 {len(password)} 位）"

    if len(password) > MAX_LENGTH:
        return f"密码不能超过 {MAX_LENGTH} 位（当前 {len(password)} 位）"

    if any(c.isspace() for c in password):
        return "密码不能包含空格"

    if not special_chars_in(password):
        return "密码必须包含至少 1 个特殊字符（如 ! @ # $ % ^ & *）"

    return None


def is_strong(password) -> bool:
    """布尔版校验，便于脚本/测试复用"""
    return validate_password(password) is None
