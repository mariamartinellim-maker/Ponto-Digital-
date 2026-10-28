"""Gera a marca d'água dos vídeos de aprovação (PNG transparente 720x1280).

Uso (só quando quiser mudar o desenho):  python3 scripts/gerar-marca-dagua.py
O CRM usa o arquivo pronto em assets/video/marca-dagua.png; o FFmpeg apenas sobrepõe a imagem ao vídeo.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 720, 1280
BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
OUT = Path(__file__).resolve().parent.parent / "assets" / "video" / "marca-dagua.png"
WA_ICON = OUT.parent / "whatsapp-icone.png"


def centered(draw, y, text, font):
    w = draw.textbbox((0, 0), text, font=font)[2]
    return ((W - w) // 2, y)


def main():
    text = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(text)
    big, small, logo = ImageFont.truetype(BOLD, 44), ImageFont.truetype(BOLD, 31), ImageFont.truetype(BOLD, 19)
    lines = [(718, "PENDENTE DE PAGAMENTO", big), (790, "VÍDEO APENAS PARA APROVAÇÃO", small)]

    # Sombra escura borrada atrás do texto: legível em fundo claro ou escuro.
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    for y, t, f in lines:
        x, _ = centered(sd, y, t, f)
        sd.text((x + 2, y + 3), t, font=f, fill=(0, 0, 0, 230))
    shadow = shadow.filter(ImageFilter.GaussianBlur(3))

    for y, t, f in lines:
        d.text(centered(d, y, t, f), t, font=f, fill=(255, 255, 255, 240), stroke_width=1, stroke_fill=(30, 30, 30, 200))

    # Selo circular "PONTO DIGITAL" semitransparente no centro (dificulta recorte da marca).
    cx, cy, r = W // 2, 582, 56
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, 170), width=3)
    for i, t in enumerate(("PONTO", "DIGITAL")):
        x, _ = centered(d, 0, t, logo)
        d.text((x, cy - 22 + i * 24), t, font=logo, fill=(255, 255, 255, 190))

    out = Image.alpha_composite(shadow, text)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, optimize=True)
    print(f"Gerado: {OUT}")
    whatsapp_icon()


def whatsapp_icon(size=48):
    """Ícone do WhatsApp (balão verde com telefone) para o rodapé do vídeo, desenhado em 4x e reduzido."""
    S = size * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    green, white = (37, 211, 102, 255), (255, 255, 255, 255)
    c, r = S // 2, int(S * 0.40)
    # balão branco com "rabinho" embaixo à esquerda e miolo verde
    d.polygon([(int(S * 0.20), int(S * 0.66)), (int(S * 0.08), int(S * 0.94)), (int(S * 0.38), int(S * 0.84))], fill=white)
    d.ellipse((c - r - 16, c - r - 16, c + r + 16, c + r + 16), fill=white)
    d.ellipse((c - r + 8, c - r + 8, c + r - 8, c + r - 8), fill=green)
    # telefone: arco grosso com as duas pontas arredondadas
    hr = int(r * 0.52)
    d.arc((c - hr, c - hr, c + hr, c + hr), start=95, end=200, fill=white, width=int(S * 0.085))
    for ax, ay in ((-0.98, -0.20), (-0.08, 0.99)):
        px, py, e = int(c + ax * hr), int(c + ay * hr), int(S * 0.075)
        d.ellipse((px - e, py - e, px + e, py + e), fill=white)
    im = im.rotate(-12, resample=Image.BICUBIC, center=(c, c))
    im.resize((size, size), Image.LANCZOS).save(WA_ICON, optimize=True)
    print(f"Gerado: {WA_ICON}")


if __name__ == "__main__":
    main()
