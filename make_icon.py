#!/usr/bin/env python3
"""
用用户提供的图片生成 App 图标（加圆角 + 多尺寸）
"""
from PIL import Image
import os

# 用户原图
SRC = "/Users/linzhi/Downloads/IMG_8989.JPG"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# 打开原图
img = Image.open(SRC).convert('RGBA')
print(f"原图尺寸: {img.size}")

# 裁剪成正方形（居中裁剪）
w, h = img.size
side = min(w, h)
left = (w - side) // 2
top = (h - side) // 2
img = img.crop((left, top, left + side, top + side))

# 生成带圆角的图标
def make_rounded(im, size, radius_ratio=0.22):
    """缩放 + 加圆角"""
    im = im.resize((size, size), Image.LANCZOS)
    
    # 创建圆角遮罩
    mask = Image.new('L', (size, size), 0)
    from PIL import ImageDraw
    draw = ImageDraw.Draw(mask)
    radius = int(size * radius_ratio)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    
    # 应用遮罩
    result = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    result.paste(im, (0, 0), mask)
    return result

# 生成各尺寸
sizes = [512, 192, 180, 144, 96, 72]
filenames = {
    512: 'icon-512.png',
    192: 'icon-192.png', 
    180: 'apple-touch-icon.png',
    144: 'icon-144.png',
    96: 'icon-96.png',
    72: 'icon-72.png',
}

for sz in sizes:
    icon = make_rounded(img, sz)
    path = os.path.join(OUT_DIR, filenames[sz])
    icon.save(path, 'PNG')
    print(f"  ✅ {filenames[sz]} ({sz}x{sz})")

print("\n🎉 全部搞定！")
