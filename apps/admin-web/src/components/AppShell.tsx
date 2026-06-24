/**
 * AppShell — PC 端三栏布局:左侧栏 + 顶 bar + 主区域。
 *
 * 渲染策略:挂在 __root 路由上,所有需要登录的页都套这一层(子路由通过 <Outlet/> 出)。
 * 鉴权:fetchMe 失败 / 非 super_admin → 跳 /login。
 */
import * as React from 'react';
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMe, isSuperAdmin, logout, type AdminUser } from '@/lib/auth';
import { TOKENS, SIDEBAR_WIDTH, TOPBAR_HEIGHT } from '@/tokens';

interface NavItem {
  to: string;
  label: string;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: '概览',
    items: [{ to: '/', label: '仪表盘' }],
  },
  {
    title: '门店动态',
    items: [{ to: '/changes', label: '调改记录' }],
  },
  {
    title: '数据维护',
    items: [
      { to: '/uploads/promotions', label: '活动数据' },
      { to: '/uploads/products', label: '产品主数据' },
      { to: '/uploads/snapshots', label: '门店销售快照' },
    ],
  },
];

export function AppShell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    retry: false,
  });

  // 鉴权门:加载完后没登录 / 非超管 → 跳登录页
  React.useEffect(() => {
    if (meQ.isLoading) return;
    if (!meQ.data) {
      navigate({ to: '/login' });
      return;
    }
    if (!isSuperAdmin(meQ.data)) {
      navigate({ to: '/login', search: { reason: 'no-permission' } as never });
    }
  }, [meQ.isLoading, meQ.data, navigate]);

  if (meQ.isLoading) {
    return <FullPageLoader />;
  }
  if (!meQ.data || !isSuperAdmin(meQ.data)) {
    return <FullPageLoader />;
  }

  const handleLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
    qc.removeQueries({ queryKey: ['me'] });
    navigate({ to: '/login' });
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: TOKENS.bg }}>
      <Sidebar />
      <div style={{
        flex: 1,
        marginLeft: SIDEBAR_WIDTH,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}>
        <Topbar user={meQ.data} onLogout={handleLogout} />
        <main style={{
          flex: 1,
          padding: '24px 32px',
          maxWidth: '100%',
          overflow: 'auto',
        }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  const location = useLocation();
  const path = location.pathname;

  return (
    <aside style={{
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
      width: SIDEBAR_WIDTH,
      background: TOKENS.card,
      borderRight: `1px solid ${TOKENS.line}`,
      display: 'flex',
      flexDirection: 'column',
      zIndex: 10,
    }}>
      {/* 品牌 */}
      <div style={{
        height: TOPBAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        borderBottom: `1px solid ${TOKENS.lineSoft}`,
        gap: 10,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: `linear-gradient(135deg, ${TOKENS.red}, ${TOKENS.redDark})`,
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 14, letterSpacing: 0.5,
        }}>美</div>
        <div>
          <div style={{ fontSize: TOKENS.fMd, fontWeight: 700, color: TOKENS.ink, lineHeight: 1.2 }}>
            美宜佳
          </div>
          <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted, lineHeight: 1.2, marginTop: 2 }}>
            超管控制台
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {NAV.map((group, i) => (
          <div key={group.title} style={{ marginTop: i === 0 ? 0 : 16 }}>
            <div style={{
              fontSize: TOKENS.fXs,
              fontWeight: 600,
              color: TOKENS.inkMuted,
              padding: '8px 20px 6px',
              letterSpacing: 0.5,
            }}>
              {group.title}
            </div>
            {group.items.map((item) => {
              const active = path === item.to
                || (item.to !== '/' && path.startsWith(item.to));
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{
                    display: 'block',
                    position: 'relative',
                    padding: '10px 20px 10px 24px',
                    fontSize: TOKENS.fBase,
                    fontWeight: active ? 600 : 500,
                    color: active ? TOKENS.red : TOKENS.ink,
                    background: active ? TOKENS.redSoft : 'transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  {active && (
                    <span style={{
                      position: 'absolute',
                      left: 0, top: 6, bottom: 6,
                      width: 3,
                      borderRadius: '0 2px 2px 0',
                      background: TOKENS.red,
                    }} />
                  )}
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{
        padding: '12px 20px',
        borderTop: `1px solid ${TOKENS.lineSoft}`,
        fontSize: TOKENS.fXs,
        color: TOKENS.inkMuted,
      }}>
        v0.1.0-m0
      </div>
    </aside>
  );
}

function Topbar({ user, onLogout }: { user: AdminUser; onLogout: () => void }) {
  const location = useLocation();
  const title = pageTitleForPath(location.pathname);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  return (
    <header style={{
      height: TOPBAR_HEIGHT,
      background: TOKENS.card,
      borderBottom: `1px solid ${TOKENS.line}`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 32px',
      gap: 16,
      position: 'sticky',
      top: 0,
      zIndex: 5,
    }}>
      <div style={{ fontSize: TOKENS.fLg, fontWeight: 700, color: TOKENS.ink }}>
        {title}
      </div>
      <div style={{ flex: 1 }} />
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          onClick={() => setMenuOpen(o => !o)}
          style={{
            appearance: 'none',
            border: `1px solid ${TOKENS.line}`,
            background: TOKENS.card,
            padding: '6px 12px 6px 6px',
            borderRadius: 999,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: TOKENS.ink,
            fontSize: TOKENS.fBase,
          }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: TOKENS.redSoft, color: TOKENS.red,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 13,
          }}>
            {user.name.slice(0, 1) || 'A'}
          </div>
          <span>{user.name}</span>
          <span style={{ color: TOKENS.inkMuted, fontSize: 10 }}>▾</span>
        </button>
        {menuOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: TOKENS.card,
            border: `1px solid ${TOKENS.line}`,
            borderRadius: 10,
            boxShadow: TOKENS.shadow2,
            minWidth: 160,
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: `1px solid ${TOKENS.lineSoft}`,
              fontSize: TOKENS.fXs,
              color: TOKENS.inkMuted,
            }}>
              {user.email ?? user.id.slice(0, 8)}
            </div>
            <button
              onClick={() => { setMenuOpen(false); onLogout(); }}
              style={{
                width: '100%',
                appearance: 'none',
                border: 0,
                background: 'transparent',
                padding: '10px 14px',
                textAlign: 'left',
                fontSize: TOKENS.fBase,
                color: TOKENS.ink,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = TOKENS.bg)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              退出登录
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function FullPageLoader() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: TOKENS.bg,
      color: TOKENS.inkMuted,
      fontSize: TOKENS.fSm,
    }}>
      加载中…
    </div>
  );
}

function pageTitleForPath(path: string): string {
  if (path === '/' || path === '') return '仪表盘';
  if (path.startsWith('/changes')) return '调改记录';
  if (path.startsWith('/uploads/promotions')) return '活动数据上传';
  if (path.startsWith('/uploads/products')) return '产品主数据上传';
  if (path.startsWith('/uploads/snapshots')) return '门店销售快照上传';
  return '超管控制台';
}
