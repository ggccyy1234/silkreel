"""Crop the plan print to the board: rows and columns where the safelight covers a quarter of the cells. usage: plan-crop.py raw.png public/films/plan-icebreaker.png"""
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
px = im.load()
on = lambda x, y: px[x, y][0] > 128
rows = [sum(on(x, y) for x in range(0, w, 2)) / (w / 2) for y in range(h)]
y0 = next(y for y in range(h) if rows[y] > 0.25)
y1 = max(y for y in range(h) if rows[y] > 0.25)
cols = [sum(on(x, y) for y in range(y0, y1, 2)) / ((y1 - y0) / 2) for x in range(w)]
x0 = next(x for x in range(w) if cols[x] > 0.25)
x1 = max(x for x in range(w) if cols[x] > 0.25)
c = im.crop((x0, y0, x1 + 1, y1 + 1)).convert('L').point(lambda v: 255 if v > 60 else 0).convert('1')

print(c.size, round(c.size[0] / c.size[1], 3))
# the site uses it as a mask: white, with the print in the alpha channel
Image.merge('LA', (Image.new('L', c.size, 255), c.convert('L'))).save(sys.argv[2], optimize=True)
