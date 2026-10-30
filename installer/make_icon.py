"""Renders the ISL PCB application icon (installer/icon.ico, installer/icon.png and public/icon.svg).

Run: python installer/make_icon.py   (needs Pillow and the Segoe UI Bold font that comes with Windows)
The artwork: a dark tile, three orange traces lying on top of each other at 45 degrees, and "ISL" in orange below.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
S = 1024  # master canvas; every design coordinate below is on a 256 grid and scaled by 4
K = S / 256

DARK = (18, 22, 28, 255)
ORANGE = (255, 138, 31, 255)
FONT = Path("C:/Windows/Fonts/segoeuib.ttf")

# Three parallel traces at 45 degrees (rising to the right), stacked 22 units apart along the other diagonal.
TRACES = [((100 + 26 * k) - 36, (54 + 26 * k) + 36, (100 + 26 * k) + 36, (54 + 26 * k) - 36) for k in range(3)]
TRACE_WIDTH = 13
TEXT_Y = 226  # baseline of "ISL" on the 256 grid
TEXT_SIZE = 92  # pixels on the 256 grid


def render() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=48 * K, fill=DARK)
    for x0, y0, x1, y1 in TRACES:
        d.line((x0 * K, y0 * K, x1 * K, y1 * K), fill=ORANGE, width=int(TRACE_WIDTH * K))
        r = TRACE_WIDTH * K / 2
        for x, y in ((x0, y0), (x1, y1)):
            d.ellipse((x * K - r, y * K - r, x * K + r, y * K + r), fill=ORANGE)
    font = ImageFont.truetype(str(FONT), int(TEXT_SIZE * K))
    d.text((128 * K, TEXT_Y * K), "ISL", font=font, fill=ORANGE, anchor="ms")
    return img


def svg() -> str:
    lines = "".join(f'<line x1="{x0}" y1="{y0}" x2="{x1}" y2="{y1}"/>' for x0, y0, x1, y1 in TRACES)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">\n'
        '  <rect width="256" height="256" rx="48" fill="#12161c"/>\n'
        f'  <g stroke="#ff8a1f" stroke-width="{TRACE_WIDTH}" stroke-linecap="round">{lines}</g>\n'
        f'  <text x="128" y="{TEXT_Y}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="{TEXT_SIZE}" fill="#ff8a1f">ISL</text>\n'
        "</svg>\n"
    )


def main() -> None:
    master = render()
    master.resize((256, 256), Image.LANCZOS).save(HERE / "icon.png")
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(HERE / "icon.ico", sizes=sizes)
    (HERE.parent / "public" / "icon.svg").write_text(svg(), encoding="utf-8")
    print("wrote", HERE / "icon.ico", HERE / "icon.png", "and", HERE.parent / "public" / "icon.svg")


if __name__ == "__main__":
    main()
