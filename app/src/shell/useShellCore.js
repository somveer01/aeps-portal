import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { api } from '../api/client';

// State every panel shell needs (admin, distributor / super distributor, retailer): the menu from GET /api/menu, which
// item is open, which groups are expanded, the drawer on narrow screens, the account menu, own profile and app name.
// The panels add only what is theirs (the wallet balance source, the route -> screen map, the dashboard).
export default function useShellCore({ expandAll = false } = {}) {
  const { width } = useWindowDimensions();
  const isWide = width >= 860;

  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState({ title: 'Dashboard', route: '/' });
  const [expanded, setExpanded] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [profile, setProfile] = useState(null); // own profile: name, photo, contact (account menu + avatars)
  const [collapsed, setCollapsed] = useState(false); // Modern layout: sidebar reduced to its icon tiles
  const [appName, setAppName] = useState('');

  useEffect(() => {
    api.account.profile().then((r) => setProfile(r.profile)).catch(() => {});
    api.publicSettings().then((s) => setAppName((s.app && s.app.appName) || '')).catch(() => {});
    api.menu().then(({ menu: m }) => {
      setMenu(m);
      if (expandAll) {
        const exp = {};
        m.forEach((n) => { if (n.children && n.children.length) exp[n.id] = true; });
        setExpanded(exp);
      }
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [expandAll]);

  // Open a screen (the panel wraps this to also refresh its wallet balance).
  const open = (item) => { setActive({ route: item.route, title: item.title }); if (!isWide) setDrawerOpen(false); };
  const toggleGroup = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const expandGroups = (ids) => setExpanded((e) => { const n = { ...e }; ids.forEach((id) => { n[id] = true; }); return n; });
  const expandEvery = () => {
    const ids = [];
    const walk = (nodes) => (nodes || []).forEach((n) => { if (n.children && n.children.length) { ids.push(n.id); walk(n.children); } });
    walk(menu);
    setExpanded(Object.fromEntries(ids.map((id) => [id, true])));
  };
  const collapseEvery = () => setExpanded({});

  return {
    isWide, menu, loading, error, active, expanded, drawerOpen, setDrawerOpen, userMenu, setUserMenu,
    profile, setProfile, collapsed, setCollapsed, appName, open, toggleGroup, expandGroups, expandEvery, collapseEvery,
  };
}
