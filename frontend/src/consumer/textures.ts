// Procedural canvas textures: no image downloads, so the site works offline.
import * as THREE from "three";

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Deterministic pseudo-random so textures look identical on every load.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export function brickTexture(): THREE.CanvasTexture {
  const r = rng(7);
  return canvas(
    256,
    256,
    (g) => {
      g.fillStyle = "#cfc6b8"; // mortar
      g.fillRect(0, 0, 256, 256);
      const bh = 16;
      const bw = 48;
      for (let row = 0; row < 256 / bh; row++) {
        const offset = row % 2 ? bw / 2 : 0;
        for (let x = -bw; x < 256 + bw; x += bw) {
          const shade = 0.82 + r() * 0.3;
          const base = [168, 82, 58].map((c) => Math.min(255, Math.round(c * shade)));
          g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
          g.fillRect(x + offset + 1.5, row * bh + 1.5, bw - 3, bh - 3);
        }
      }
    },
    [1, 1],
  );
}

export function roofTexture(): THREE.CanvasTexture {
  const r = rng(11);
  return canvas(
    256,
    256,
    (g) => {
      g.fillStyle = "#2f3337";
      g.fillRect(0, 0, 256, 256);
      const th = 20;
      for (let row = 0; row < 256 / th; row++) {
        const offset = row % 2 ? 14 : 0;
        for (let x = -28; x < 256 + 28; x += 28) {
          const v = 52 + Math.round(r() * 22);
          g.fillStyle = `rgb(${v},${v + 4},${v + 8})`;
          g.fillRect(x + offset + 1, row * th + 1, 26, th - 2);
          g.fillStyle = "rgba(0,0,0,0.25)";
          g.fillRect(x + offset + 1, row * th + th - 4, 26, 3);
        }
      }
    },
    [3, 3],
  );
}

export function grassTexture(): THREE.CanvasTexture {
  const r = rng(23);
  return canvas(
    256,
    256,
    (g) => {
      g.fillStyle = "#4f7a3a";
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 5000; i++) {
        const v = r();
        g.fillStyle = v > 0.5 ? `rgba(110,160,70,${0.25 + r() * 0.3})` : `rgba(40,70,30,${0.2 + r() * 0.3})`;
        g.fillRect(r() * 256, r() * 256, 1.5, 3);
      }
    },
    [14, 14],
  );
}

export function woodTexture(): THREE.CanvasTexture {
  const r = rng(31);
  return canvas(
    256,
    256,
    (g) => {
      for (let i = 0; i < 8; i++) {
        const v = 0.85 + r() * 0.25;
        g.fillStyle = `rgb(${Math.round(176 * v)},${Math.round(132 * v)},${Math.round(90 * v)})`;
        g.fillRect(0, i * 32, 256, 32);
        g.fillStyle = "rgba(60,35,15,0.35)";
        g.fillRect(0, i * 32 + 31, 256, 1);
        for (let k = 0; k < 30; k++) {
          g.fillStyle = `rgba(90,55,25,${0.08 + r() * 0.1})`;
          g.fillRect(r() * 256, i * 32 + r() * 30, 20 + r() * 60, 1);
        }
      }
    },
    [2, 2],
  );
}

export function pavingTexture(): THREE.CanvasTexture {
  const r = rng(41);
  return canvas(
    128,
    128,
    (g) => {
      g.fillStyle = "#8d8a84";
      g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 32)
        for (let x = 0; x < 128; x += 32) {
          const v = 150 + Math.round(r() * 30);
          g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
          g.fillRect(x + 1, y + 1, 30, 30);
        }
    },
    [1, 4],
  );
}
