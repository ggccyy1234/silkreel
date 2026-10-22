# usage: python3 scripts/sheet.py out.png cols width img...
import sys
from PIL import Image, ImageDraw
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = [Image.open(p).convert('RGB') for p in sys.argv[4:]]
h = int(ims[0].height * w / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * (h + 18)), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, (p, im) in enumerate(zip(sys.argv[4:], ims)):
    x, y = (i % cols) * w, (i // cols) * (h + 18)
    sheet.paste(im.resize((w, h)), (x, y + 18))
    d.text((x + 4, y + 3), p.split('/')[-1], fill=(255, 255, 0))
sheet.save(out)
