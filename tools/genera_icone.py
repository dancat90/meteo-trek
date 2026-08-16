#!/usr/bin/env python3
"""
Genera icon-512.png e icon-192.png della PWA meteo-trek.

Icona: sfondo scuro pieno (maskable), profilo di montagna stilizzato con
un sentiero colorato per rischio meteo (verde -> rosso) e un sole.

Uso: python tools/genera_icone.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SFONDO = (13, 17, 23, 255)        # #0d1117, dark theme del progetto
# Palette 4 classi di rischio del progetto
COLORI = [(46, 160, 67), (242, 204, 96), (240, 136, 62), (218, 54, 51)]
MONTAGNA = (48, 54, 61, 255)      # #30363d
NEVE = (201, 209, 217, 255)
SOLE = (242, 204, 96, 255)


def lerp(a, b, t):
    return a + (b - a) * t


def colore_gradiente(t):
    """Interpola i 4 colori di rischio lungo t in [0,1]."""
    seg = min(int(t * 3), 2)
    frac = t * 3 - seg
    c1, c2 = COLORI[seg], COLORI[seg + 1]
    return tuple(int(lerp(c1[i], c2[i], frac)) for i in range(3)) + (255,)


def bezier(p0, p1, p2, t):
    """Punto sulla bezier quadratica."""
    x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t**2 * p2[0]
    y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t**2 * p2[1]
    return x, y


def disegna(dim):
    img = Image.new("RGBA", (dim, dim), SFONDO)
    d = ImageDraw.Draw(img)
    s = dim / 512  # fattore di scala rispetto al disegno base 512

    # Sole in alto a destra
    cx, cy, r = 400 * s, 118 * s, 46 * s
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SOLE)

    # Due montagne sovrapposte
    d.polygon(
        [(30 * s, 420 * s), (210 * s, 150 * s), (390 * s, 420 * s)],
        fill=MONTAGNA,
    )
    d.polygon(
        [(240 * s, 420 * s), (380 * s, 230 * s), (500 * s, 420 * s)],
        fill=(38, 44, 52, 255),
    )
    # Nevaio sulla cima principale
    d.polygon(
        [(210 * s, 150 * s), (245 * s, 205 * s), (215 * s, 210 * s), (185 * s, 200 * s)],
        fill=NEVE,
    )

    # Sentiero: bezier dal basso-sinistra verso la cima, colorato a rischio
    p0, p1, p2 = (60 * s, 470 * s), (250 * s, 420 * s), (218 * s, 165 * s)
    spessore = int(26 * s)
    passi = 48
    punti = [bezier(p0, p1, p2, i / passi) for i in range(passi + 1)]
    for i in range(passi):
        col = colore_gradiente(i / (passi - 1))
        d.line([punti[i], punti[i + 1]], fill=col, width=spessore)
        # Giunti rotondi per evitare spigoli tra i segmenti
        r2 = spessore / 2
        x, y = punti[i + 1]
        d.ellipse([x - r2, y - r2, x + r2, y + r2], fill=col)

    return img


for dim, nome in [(512, "icon-512.png"), (192, "icon-192.png")]:
    # Disegna a risoluzione doppia e riduci per l'antialiasing
    img = disegna(dim * 2).resize((dim, dim), Image.LANCZOS)
    img.save(ROOT / nome)
    print(f"Scritta {nome}")
