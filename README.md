# Sundial 64

An original browser-based 3D platformer inspired by N64-era collectathons. Switch between day and night to freeze waterfalls, stop clockwork gears, and materialize platforms. Korean interface. Audio is off by default.

## Play

https://yusunglee2074.github.io/sundial-64/

Desktop keyboard and mouse required. WASD moves, Space jumps, Shift crouches or ground-pounds, F switches day/night, R creates a temporary platform, and H opens the moves guide.

## Development

```sh
npm ci
npm run dev
npm run build
```

GitHub Actions builds and deploys `main` to GitHub Pages. All character models, environment geometry, textures and sounds are generated procedurally; no Nintendo assets are included.
