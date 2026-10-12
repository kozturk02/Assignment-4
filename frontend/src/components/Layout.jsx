import { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

function Layout({ children }) {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="app-shell">
      <header className="header">
        <Link to="/" className="header-title">Autonomous Supermarket</Link>
        <nav className="header-navigation" aria-label="Main navigation">
          <NavLink to="/" end>Home</NavLink>
        </nav>
      </header>
      <main className="dashboard">
        {children}
      </main>
    </div>
  );
}

export default Layout;
