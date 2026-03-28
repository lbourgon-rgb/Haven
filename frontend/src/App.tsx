import { useState, useEffect, useCallback } from 'react';
import { getCompanion } from './lib/api';
import Sidebar from './components/Sidebar';
import ChatContainer from './components/ChatContainer';
import SetupWizard from './components/SetupWizard';
import ImportWizard from './components/ImportWizard';
import Settings from './pages/Settings';

type Route = 'chat' | 'settings';

function getRoute(): Route {
  const hash = window.location.hash.replace('#', '') || window.location.pathname;
  if (hash === '/settings' || hash === 'settings') return 'settings';
  return 'chat';
}

export default function App() {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [companionName, setCompanionName] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState<Route>(getRoute);

  // Listen for navigation
  useEffect(() => {
    const onNav = () => setRoute(getRoute());
    window.addEventListener('hashchange', onNav);
    window.addEventListener('popstate', onNav);
    return () => {
      window.removeEventListener('hashchange', onNav);
      window.removeEventListener('popstate', onNav);
    };
  }, []);

  // Handle <a href="/settings"> and <a href="/"> clicks
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a');
      if (!target) return;
      const href = target.getAttribute('href');
      if (href === '/settings') {
        e.preventDefault();
        setRoute('settings');
        window.history.pushState(null, '', '/settings');
      } else if (href === '/') {
        e.preventDefault();
        setRoute('chat');
        window.history.pushState(null, '', '/');
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Fetch companion on mount
  useEffect(() => {
    getCompanion()
      .then((c) => {
        setCompanionName(c.name);
        if (c.name === 'Companion') {
          setNeedsSetup(true);
        }
      })
      .catch(() => {
        setNeedsSetup(true);
      })
      .finally(() => setLoaded(true));
  }, []);

  const handleSetupComplete = useCallback(() => {
    setNeedsSetup(false);
    getCompanion()
      .then((c) => setCompanionName(c.name))
      .catch(() => {});
  }, []);

  const handleSelectThread = useCallback((id: string) => {
    setActiveThreadId(id);
  }, []);

  const handleNewThread = useCallback((id: string) => {
    setActiveThreadId(id);
  }, []);

  const handleThreadCreated = useCallback((id: string) => {
    setActiveThreadId(id);
  }, []);

  if (!loaded) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--haven-bg)',
      }}>
        <div style={{
          width: '24px', height: '24px', border: '2px solid var(--haven-accent)',
          borderTopColor: 'transparent', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (needsSetup) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--haven-bg)' }}>
      {/* Sidebar */}
      <Sidebar
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onNewThread={handleNewThread}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        companionName={companionName}
      />

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Mobile hamburger */}
        <div className="lg:hidden" style={{
          position: 'absolute', top: '10px', left: '10px', zIndex: 30,
        }}>
          {!sidebarOpen && route === 'chat' && (
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                background: 'var(--haven-surface)', border: '1px solid var(--haven-border)',
                borderRadius: '8px', padding: '6px 8px', cursor: 'pointer',
                color: 'var(--haven-text)',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          )}
        </div>

        {/* Route content */}
        {route === 'settings' ? (
          <Settings onImport={() => setShowImport(true)} />
        ) : (
          <ChatContainer
            threadId={activeThreadId}
            onThreadCreated={handleThreadCreated}
            companionName={companionName}
          />
        )}
      </div>

      {/* Import Wizard */}
      {showImport && (
        <ImportWizard
          onClose={() => setShowImport(false)}
          onComplete={() => { setShowImport(false); window.location.reload(); }}
        />
      )}
    </div>
  );
}
