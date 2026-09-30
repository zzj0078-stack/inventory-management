"""生成移动端 PWA 图标（192 / 512）。

用 Pillow 画一个圆角蓝底 + 白色「进」字，和登录页的视觉一致。
512 同时当作 maskable 用 —— 因为底色是满幅的，被裁成圆形也不露白边。

用法：python cf/make_mobile_icons.py
"""
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("需要 Pillow：pip install Pillow")
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "frontend", "public")

PRIMARY = (47, 111, 237)  # #2f6fed
WHITE = (255, 255, 255)

# Windows 常见中文字体，按可用性依次尝试
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",  # 微软雅黑 Bold
    r"C:\Windows\Fonts\msyh.ttc",    # 微软雅黑
    r"C:\Windows\Fonts\simhei.ttf",  # 黑体
    r"C:\Windows\Fonts\simsun.ttc",  # 宋体
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return None


def make_icon(size, rounded=True):
    """满幅蓝底 + 居中白字；radius 只影响可见圆角，不影响 maskable 安全性"""
    # 用 4 倍超采样再缩小，边缘更平滑
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if rounded:
        radius = int(s * 0.22)
        draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=PRIMARY)
    else:
        draw.rectangle([0, 0, s - 1, s - 1], fill=PRIMARY)

    # 字号取边长的 52%，居中绘制
    font = load_font(int(s * 0.52))
    if font is None:
        # 找不到中文字体就退回一个几何标记，保证脚本仍能出图
        draw.ellipse(
            [int(s * 0.3), int(s * 0.3), int(s * 0.7), int(s * 0.7)],
            outline=WHITE,
            width=int(s * 0.05),
        )
    else:
        text = "进"
        # 用 textbbox 精确居中（不同字体的基线不同）
        bbox = draw.textbbox((0, 0), text, font=font)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        draw.text(
            ((s - w) / 2 - bbox[0], (s - h) / 2 - bbox[1]),
            text,
            font=font,
            fill=WHITE,
        )

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (192, 512):
        out = os.path.join(OUT_DIR, f"mobile-icon-{size}.png")
        icon = make_icon(size)
        # 转 RGB 去掉 alpha 通道，避免个别启动器显示异常
        icon.convert("RGB").save(out, "PNG", optimize=True)
        print(f"已生成 {out}  ({os.path.getsize(out)} bytes)")


if __name__ == "__main__":
    main()
