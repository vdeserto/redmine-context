"""Gera o print de erro usado no demo (anexo de imagem para o OCR)."""
from PIL import Image, ImageDraw, ImageFont

LINES = [
    ("Traceback (most recent call last):", "#1a1a1a"),
    ('  File "billing/invoice.py", line 214, in generate', "#1a1a1a"),
    ("    total = order.subtotal * (1 + tax_rate)", "#1a1a1a"),
    ("TypeError: unsupported operand type(s) for *:", "#b00020"),
    ("    'NoneType' and 'float'", "#b00020"),
    ("", "#1a1a1a"),
    ("Order ID: 88421    Customer: ACME Ltda", "#1a1a1a"),
    ("Env: production    Build: 4.2.1", "#1a1a1a"),
]
FONT = "/System/Library/Fonts/Supplemental/Courier New Bold.ttf"
font = ImageFont.truetype(FONT, 26)
img = Image.new("RGB", (1020, 330), "#f7f7f5")
d = ImageDraw.Draw(img)
d.rectangle([0, 0, 1019, 44], fill="#e4e4e0")
d.text((20, 12), "Console - production", font=ImageFont.truetype(FONT, 20), fill="#555")
for i, (line, color) in enumerate(LINES):
    d.text((26, 70 + i * 32), line, font=font, fill=color)
img.save("fixture-error.png")
print("fixture-error.png gerado:", img.size)
