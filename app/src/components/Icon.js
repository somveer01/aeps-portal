import React from 'react';
import Svg, { Path, Rect, Circle } from 'react-native-svg';

// Icon set keyed by the `icon` column on menu_items (matches the web app).
const P = { stroke: 'currentColor', strokeWidth: 1.7, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };

export default function Icon({ name, size = 18, color = '#cbd5e1' }) {
  const p = { ...P, stroke: color };
  let body;
  switch (name) {
    case 'grid':
      body = (<>
        <Rect x="3" y="3" width="7" height="7" {...p} /><Rect x="14" y="3" width="7" height="7" {...p} />
        <Rect x="3" y="14" width="7" height="7" {...p} /><Rect x="14" y="14" width="7" height="7" {...p} />
      </>); break;
    case 'bank':
      body = <Path d="M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 5H3l9-5z" {...p} />; break;
    case 'cash':
      body = (<><Rect x="2" y="6" width="20" height="12" rx="2" {...p} /><Circle cx="12" cy="12" r="2.5" {...p} /></>); break;
    case 'send':
      body = <Path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" {...p} />; break;
    case 'phone':
      body = (<><Rect x="7" y="2" width="10" height="20" rx="2" {...p} /><Path d="M11 18h2" {...p} /></>); break;
    case 'receipt':
      body = <Path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3zM8 8h8M8 12h8M8 16h5" {...p} />; break;
    case 'wallet':
      body = (<><Rect x="3" y="6" width="18" height="13" rx="2" {...p} /><Path d="M16 12h2" {...p} /></>); break;
    case 'atm':
      body = (<><Rect x="3" y="4" width="18" height="14" rx="2" {...p} /><Path d="M7 22h10M8 8h8M8 12h5" {...p} /></>); break;
    case 'layers':
      body = (<><Path d="M12 2 2 7l10 5 10-5-10-5z" {...p} /><Path d="M2 12l10 5 10-5" {...p} /><Path d="M2 17l10 5 10-5" {...p} /></>); break;
    case 'category':
      body = (<><Rect x="3" y="3" width="8" height="8" rx="1.5" {...p} /><Rect x="13" y="3" width="8" height="8" rx="1.5" {...p} /><Rect x="3" y="13" width="8" height="8" rx="1.5" {...p} /><Rect x="13" y="13" width="8" height="8" rx="1.5" {...p} /></>); break;
    case 'map':
      body = (<><Path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2z" {...p} /><Path d="M9 3v16M15 5v16" {...p} /></>); break;
    case 'users':
      body = (<><Circle cx="9" cy="8" r="3.2" {...p} /><Path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" {...p} /><Path d="M16 4.5a3 3 0 0 1 0 6M17 14c2.2.5 4 2.5 4 5" {...p} /></>); break;
    case 'services':
      body = (<><Rect x="3" y="4" width="18" height="4" rx="1" {...p} /><Rect x="3" y="10" width="18" height="4" rx="1" {...p} /><Rect x="3" y="16" width="18" height="4" rx="1" {...p} /></>); break;
    case 'plan':
      body = (<><Rect x="5" y="3" width="14" height="18" rx="2" {...p} /><Path d="M9 3h6v3H9zM8 11h8M8 15h5" {...p} /></>); break;
    case 'image':
      body = (<><Rect x="3" y="3" width="18" height="18" rx="2" {...p} /><Circle cx="8.5" cy="8.5" r="1.5" {...p} /><Path d="M21 15l-5-5L5 21" {...p} /></>); break;
    case 'ticket':
      body = (<><Path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" {...p} /><Path d="M13 6.5v11" {...p} /></>); break;
    case 'announcement':
      body = (<><Path d="M3 11v2a1 1 0 0 0 1 1h2l3 4V6L6 10H4a1 1 0 0 0-1 1z" {...p} /><Path d="M14 7a5 5 0 0 1 0 10M13 6l6-3v18l-6-3" {...p} /></>); break;
    case 'book':
      body = (<><Path d="M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 0-2 2z" {...p} /><Path d="M5 20V6M9 6h6" {...p} /></>); break;
    case 'report':
      body = (<><Rect x="3" y="3" width="18" height="18" rx="2" {...p} /><Path d="M8 16v-4M12 16v-7M16 16v-2" {...p} /></>); break;
    case 'fund':
      body = (<><Rect x="2" y="6" width="20" height="13" rx="2" {...p} /><Circle cx="12" cy="12.5" r="2.5" {...p} /><Path d="M6 10h.5M17.5 15h.5" {...p} /></>); break;
    case 'transfer':
      body = (<><Path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" {...p} /></>); break;
    case 'commission':
      body = (<><Circle cx="7" cy="7" r="2.2" {...p} /><Circle cx="17" cy="17" r="2.2" {...p} /><Path d="M6 18 18 6" {...p} /></>); break;
    case 'verify':
      body = (<><Path d="M12 2 4 5v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V5l-8-3z" {...p} /><Path d="M9 12l2 2 4-4" {...p} /></>); break;
    case 'lock':
      body = (<><Rect x="4" y="10" width="16" height="11" rx="2" {...p} /><Path d="M8 10V7a4 4 0 0 1 8 0v3" {...p} /><Circle cx="12" cy="15.5" r="1.3" {...p} /></>); break;
    case 'logout':
      body = (<><Path d="M15 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h9" {...p} /><Path d="M18 15l3-3-3-3M21 12H10" {...p} /></>); break;
    case 'search':
      body = (<><Circle cx="11" cy="11" r="7" {...p} /><Path d="M21 21l-4.3-4.3" {...p} /></>); break;
    case 'settings':
      body = (<><Circle cx="12" cy="12" r="3" {...p} /><Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" {...p} /></>); break;
    case 'user':
      body = (<><Circle cx="12" cy="8" r="4" {...p} /><Path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7" {...p} /></>); break;
    case 'key':
      body = (<><Circle cx="7.5" cy="15.5" r="4.5" {...p} /><Path d="M10.7 12.3 21 2M16 7l3 3M14 9l2 2" {...p} /></>); break;
    case 'shield':
      body = (<><Path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3z" {...p} /><Path d="M9 12l2 2 4-4" {...p} /></>); break;
    case 'refresh':
      body = (<><Path d="M21 12a9 9 0 1 1-2.6-6.4" {...p} /><Path d="M21 3v6h-6" {...p} /></>); break;
    case 'plus':
      body = <Path d="M12 5v14M5 12h14" {...p} />; break;
    case 'camera':
      body = (<><Path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" {...p} /><Circle cx="12" cy="13.5" r="3.5" {...p} /></>); break;
    case 'chevron':
      body = <Path d="M9 6l6 6-6 6" {...p} />; break;
    case 'menu':
      body = <Path d="M4 6h16M4 12h10M4 18h16" {...p} />; break;
    case 'cart':
      body = (<><Circle cx="9" cy="20" r="1.3" {...p} /><Circle cx="18" cy="20" r="1.3" {...p} /><Path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" {...p} /></>); break;
    case 'check':
      body = (<><Circle cx="12" cy="12" r="9" {...p} /><Path d="M8 12.5l2.5 2.5L16 9.5" {...p} /></>); break;
    case 'clock':
      body = (<><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 7v5l3 2" {...p} /></>); break;
    case 'xcircle':
      body = (<><Circle cx="12" cy="12" r="9" {...p} /><Path d="M9 9l6 6M15 9l-6 6" {...p} /></>); break;
    case 'arrowDown':
      body = <Path d="M12 5v14M6 13l6 6 6-6" {...p} />; break;
    case 'arrowUp':
      body = <Path d="M12 19V5M6 11l6-6 6 6" {...p} />; break;
    case 'filter':
      body = <Path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" {...p} />; break;
    case 'calendar':
      body = (<><Rect x="3" y="5" width="18" height="16" rx="2" {...p} /><Path d="M8 3v4M16 3v4M3 10h18" {...p} /></>); break;
    case 'trend':
      body = <Path d="M3 17l6-6 4 4 8-8M15 7h6v6" {...p} />; break;
    case 'package':
      body = <Path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" {...p} />; break;
    default:
      body = <Circle cx="12" cy="12" r="3" {...p} />;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24">{body}</Svg>;
}
