import { useState, useEffect, useCallback } from 'react';
import { getCompanion } from './lib/api';
import ThreadList from './components/ThreadList';
import ChatContainer from './components/ChatContainer';
import SetupWizard from './components/SetupWizard';
import ImportWizard from './components/ImportWizard';
import Settings from './pages/Settings';

type View = 'threads' | 'chat' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('threads');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [companionName, setCompanionName] = useState('');
  const [companionAvatar, setCompanionAvatar] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getCompanion()
      .then((c) => {
        setCompanionName(c.name);
        setCompanionAvatar(c.avatar_url || '');
        if (c.name === 'Companion') setNeedsSetup(true);
      })
      .catch(() => setNeedsSetup(true))
      .finally(() => setLoaded(true));
  }, []);

  // Handle browser back button
  useEffect(() => {
    const onPop = () => {
      if (view === 'chat') setView('threads');
      else if (view === 'settings') setView('threads');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [view]);

  const openThread = useCallback((id: string) => {
    setActiveThreadId(id);
    setView('chat');
    window.history.pushState({ view: 'chat' }, '');
  }, []);

  const openNewThread = useCallback(() => {
    setActiveThreadId(null);
    setView('chat');
    window.history.pushState({ view: 'chat' }, '');
  }, []);

  const goBack = useCallback(() => {
    setView('threads');
    window.history.back();
  }, []);

  const handleThreadCreated = useCallback((id: string) => {
    setActiveThreadId(id);
  }, []);

  const handleSetupComplete = useCallback(() => {
    setNeedsSetup(false);
    getCompanion()
      .then((c) => {
        setCompanionName(c.name);
        setCompanionAvatar(c.avatar_url || '');
      })
      .catch(() => {});
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
    <div style={{ height: '100%', background: 'var(--haven-bg)' }}>
      {/* Thread List (home) */}
      {view === 'threads' && (
        <ThreadList
          companionName={companionName}
          companionAvatar={companionAvatar}
          onSelectThread={openThread}
          onNewThread={openNewThread}
          onOpenSettings={() => { setView('settings'); window.history.pushState({ view: 'settings' }, ''); }}
          onOpenImport={() => setShowImport(true)}
        />
      )}

      {/* Chat */}
      {view === 'chat' && (
        <ChatContainer
          threadId={activeThreadId}
          onThreadCreated={handleThreadCreated}
          companionName={companionName}
          companionAvatar={companionAvatar}
          onBack={goBack}
        />
      )}

      {/* Settings */}
      {view === 'settings' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Settings onImport={() => setShowImport(true)} onBack={goBack} />
        </div>
      )}

      {/* Import Wizard */}
      {showImport && (
        <ImportWizard
          onClose={() => setShowImport(false)}
          onComplete={() => { setShowImport(false); setView('threads'); }}
        />
      )}
    </div>
  );
}
