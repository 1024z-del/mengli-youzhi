#!/usr/bin/env python3
"""
生成「梦里有zhi」App 图标
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math

SIZE = 512  # 图标尺寸

# 创建画布（圆角方形）
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# 画紫色渐变背景（圆角）
def lerp(a, b, t):
    return int(a + (b - a) * t)

# 渐变：从 #8B6FC9（左上）到 #5B3FA0（右下）
for y in range(SIZE):
    t = y / SIZE
    r = lerp(139, 91, t)
    g = lerp(111, 63, t)
    b = lerp(201, 160, t)
    draw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

# 创建圆角遮罩
mask = Image.new('L', (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
radius = 110
mask_draw.rounded_rectangle([0, 0, SIZE-1, SIZE-1], radius, fill=255)

# 应用圆角
result = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
result.paste(img, (0, 0), mask)
img = result
draw = ImageDraw.Draw(img)

# ===== 画月亮 =====
# 月亮位置：左上偏中
cx, cy = 340, 160
moon_r = 70

# 画月亮（用圆形 + 重叠圆形做出月牙效果）
moon = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
mdraw = ImageDraw.Draw(moon)

# 满月（淡黄）
mdraw.ellipse([cx - moon_r, cy - moon_r, cx + moon_r, cy + moon_r], 
              fill=(255, 248, 220, 255))

# 用深紫色圆盖住一部分，形成月牙
offset = 35
mdraw.ellipse([cx - moon_r + offset, cy - moon_r - 10, 
               cx + moon_r + offset, cy + moon_r - 10], 
              fill=(91, 63, 160, 255))

# 月亮加一点光晕
glow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
gdraw = ImageDraw.Draw(glow)
gdraw.ellipse([cx - moon_r - 15, cy - moon_r - 15, 
               cx + moon_r + 15, cy + moon_r + 15], 
              fill=(255, 248, 220, 60))
glow = glow.filter(ImageFilter.GaussianBlur(radius=20))
img = Image.alpha_composite(img, glow)
img = Image.alpha_composite(img, moon)

# ===== 画星星 =====
star_color = (255, 255, 255, 230)
stars = [
    (120, 100, 3), (180, 80, 2), (220, 130, 2.5),
    (100, 180, 2), (80, 220, 1.5), (420, 90, 2),
    (450, 200, 2), (380, 230, 1.5),
]
for sx, sy, sr in stars:
    draw.ellipse([sx - sr*2, sy - sr*2, sx + sr*2, sy + sr*2], fill=star_color)

# ===== 画日记本 =====
# 日记本位置：下方居中
book_x, book_y = 120, 250
book_w, book_h = 270, 200

# 书的阴影
shadow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
sdraw = ImageDraw.Draw(shadow)
sdraw.rounded_rectangle([book_x + 8, book_y + 8, 
                         book_x + book_w + 8, book_y + book_h + 8], 
                        radius=15, fill=(0, 0, 0, 50))
shadow = shadow.filter(ImageFilter.GaussianBlur(radius=8))
img = Image.alpha_composite(img, shadow)

# 书本主体（米白色）
book = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
bdraw = ImageDraw.Draw(book)

# 书封面
bdraw.rounded_rectangle([book_x, book_y, 
                         book_x + book_w, book_y + book_h], 
                        radius=15, fill=(252, 245, 230, 255))

# 书的中缝（中间竖线）
mid_x = book_x + book_w // 2
bdraw.line([(mid_x, book_y + 20), (mid_x, book_y + book_h - 20)], 
           fill=(200, 190, 170, 200), width=3)

# 书的左侧装订环
for i in range(5):
    ring_y = book_y + 40 + i * 30
    bdraw.ellipse([book_x - 5, ring_y - 6, book_x + 10, ring_y + 6], 
                  fill=(180, 170, 150, 255))

# 书页线条（右边）
for i in range(4):
    line_y = book_y + 50 + i * 32
    bdraw.line([(mid_x + 20, line_y), (book_x + book_w - 20, line_y)], 
               fill=(220, 210, 195, 200), width=2)

# 书本的小装饰：小星星
bdraw.ellipse([book_x + 60, book_y + 60, book_x + 75, book_y + 75], 
              fill=(139, 111, 201, 255))
bdraw.ellipse([book_x + 90, book_y + 100, book_x + 100, book_y + 110], 
              fill=(139, 111, 201, 200))

img = Image.alpha_composite(img, book)

# ===== 加一点小闪光 =====
sparkles = [(60, 350), (450, 380), (480, 320)]
for sx, sy in sparkles:
    size = 6
    draw.line([(sx - size, sy), (sx + size, sy)], fill=(255, 255, 255, 180), width=2)
    draw.line([(sx, sy - size), (sx, sy + size)], fill=(255, 255, 255, 180), width=2)

# ===== 保存多种尺寸 =====
import os
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)))

# 主图标 512x512
img.save(os.path.join(out_dir, 'icon-512.png'))

# 192x192
img.resize((192, 192), Image.LANCZOS).save(os.path.join(out_dir, 'icon-192.png'))

# 144x144
img.resize((144, 144), Image.LANCZOS).save(os.path.join(out_dir, 'icon-144.png'))

# 96x96
img.resize((96, 96), Image.LANCZOS).save(os.path.join(out_dir, 'icon-96.png'))

# 72x72
img.resize((72, 72), Image.LANCZOS).save(os.path.join(out_dir, 'icon-72.png'))

# favicon 180x180 (Apple Touch Icon)
img.resize((180, 180), Image.LANCZOS).save(os.path.join(out_dir, 'apple-touch-icon.png'))

print("✅ 图标已生成！")
print(f"📁 保存位置: {out_dir}")
for f in sorted(os.listdir(out_dir)):
    if f.startswith('icon') or f.startswith('apple'):
        path = os.path.join(out_dir, f)
        size = os.path.getsize(path)
        print(f"  {f} ({size//1024}KB)")
