import L from 'leaflet'

/** A round pin drawn with CSS, so no image assets are needed. */
export const pinIcon = (label?: string) =>
  L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:#0f766e;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:700 12px system-ui">${label ?? ''}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  })

export const OSM_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}
