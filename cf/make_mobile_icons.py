"""生成 PWA 图标（192 / 512）—— 移动端与桌面端两套。

用 Pillow 画一个圆角蓝底 + 白色「进」字，和登录页的视觉一致。
512 同时当作 maskable 用 —— 因为底色是满幅的，被裁成圆形也不露白边。

输出两套（同一视觉，两套文件名各自对应一个入口的 manifest）：
  frontend/public/mobile-icon-{192,512}.png  ← mobile-manifest.json
  frontend/public/icon-{192,512}.png         ← manifest.json（桌面端）

⚠️ 图标必须是**真正的 PNG**。此前桌面端图标是「SVG 内容 + .png 后缀」，
   Pages 会按 image/png 返回，浏览器解析失败，安装到主屏幕后图标是空白。
   所以图标一律由本脚本生成，不要手写。

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


def make_icon(size):
    """满幅蓝底 + 居中白字。

    ⚠️ 必须**满幅、无透明**：
      - maskable 图标会被启动器裁成圆形/方形，只有中央 80% 圆是安全区。
        透明或留白的角落被裁进来就会露底。
      - 画「圆角 + 透明」再 convert("RGB") 会把透明像素变成**黑色**，
        于是四角出现黑三角（历史版本就是这样）。
    「进」字取边长的 52% 居中：其外接框角点距中心约 36.8% < 40%，落在安全区内。
    """
    # 用 4 倍超采样再缩小，边缘更平滑
    scale = 4
    s = size * scale
    img = Image.new("RGB", (s, s), PRIMARY)
    draw = ImageDraw.Draw(img)

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
    # 两套图标：移动端 / 桌面端，视觉一致，只是文件名不同
    for prefix in ("mobile-icon", "icon"):
        for size in (192, 512):
            out = os.path.join(OUT_DIR, f"{prefix}-{size}.png")
            icon = make_icon(size)
            # make_icon 已经是 RGB 满幅，直接存
            icon.save(out, "PNG", optimize=True)
            print(f"已生成 {out}  ({os.path.getsize(out)} bytes)")


if __name__ == "__main__":
    main()
