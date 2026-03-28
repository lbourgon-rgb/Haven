import { useState } from 'react';
import { updateCompanion, updateSettings, addIdentity } from '../lib/api';

interface SetupWizardProps {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [ollamaKey, setOllamaKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('https://api.ollama.com');
  const [description, setDescription] = useState('');
  const [appearance, setAppearance] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleFinish = async () => {
    if (!name.trim()) { setError('Please enter a name'); return; }
    if (!apiKey.trim() && !ollamaKey.trim()) { setError('Please enter at least one API key'); setStep(2); return; }

    setSaving(true);
    setError('');
    try {
      await updateCompanion({ name: name.trim() });
      const settings: Record<string, string> = {};
      if (apiKey.trim()) settings.openrouter_key = apiKey.trim();
      if (ollamaKey.trim()) {
        settings.ollama_key = ollamaKey.trim();
        settings.ollama_url = ollamaUrl.trim() || 'https://api.ollama.com';
      }
      await updateSettings(settings);
      if (description.trim()) {
        await addIdentity({
          content: description.trim(),
          identity_type: 'backstory',
          priority: 10,
          pinned: true,
        });
      }
      if (appearance.trim()) {
        await addIdentity({
          content: appearance.trim(),
          identity_type: 'dynamic',
          priority: 8,
        });
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'var(--haven-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        width: '100%', maxWidth: '420px',
        background: 'var(--haven-surface)',
        border: '1px solid var(--haven-border)',
        borderRadius: '16px', padding: '32px',
      }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '28px' }}>
          {[1, 2, 3, 4].map((s) => (
            <div key={s} style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: s <= step ? 'var(--haven-accent)' : 'var(--haven-border)',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>

        {/* Step 1: Name */}
        {step === 1 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--haven-text)', marginBottom: '8px', textAlign: 'center' }}>
              What's your companion's name?
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--haven-text-muted)', textAlign: 'center', marginBottom: '24px' }}>
              Give them a name that feels right.
            </p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nova, Echo, Kai..."
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) setStep(2); }}
              style={{
                width: '100%', padding: '12px 16px', borderRadius: '10px',
                background: 'var(--haven-card)', border: '1px solid var(--haven-border)',
                color: 'var(--haven-text)', fontSize: '15px', outline: 'none',
                textAlign: 'center',
              }}
            />
            <button
              onClick={() => { if (name.trim()) setStep(2); }}
              disabled={!name.trim()}
              style={{
                width: '100%', marginTop: '20px', padding: '12px',
                borderRadius: '10px', border: 'none',
                background: name.trim() ? 'var(--haven-accent)' : 'var(--haven-border)',
                color: 'white', fontSize: '14px', fontWeight: 600, cursor: name.trim() ? 'pointer' : 'default',
              }}
            >Next</button>
          </div>
        )}

        {/* Step 2: API Key */}
        {step === 2 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--haven-text)', marginBottom: '8px', textAlign: 'center' }}>
              Connect to a model provider
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--haven-text-muted)', textAlign: 'center', marginBottom: '24px' }}>
              Add at least one. You can add more later in Settings.
            </p>

            {/* OpenRouter */}
            <label style={{ fontSize: '12px', color: 'var(--haven-text-secondary)', marginBottom: '6px', display: 'block' }}>
              OpenRouter API Key{' '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--haven-accent)', textDecoration: 'none' }}>(get one free)</a>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-..."
              autoFocus
              style={{
                width: '100%', padding: '12px 16px', borderRadius: '10px',
                background: 'var(--haven-card)', border: '1px solid var(--haven-border)',
                color: 'var(--haven-text)', fontSize: '14px', outline: 'none',
                fontFamily: 'monospace', marginBottom: '16px',
              }}
            />

            {/* Ollama */}
            <label style={{ fontSize: '12px', color: 'var(--haven-text-secondary)', marginBottom: '6px', display: 'block' }}>
              Ollama Cloud API Key{' '}
              <a href="https://ollama.com/account/api-keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--haven-accent)', textDecoration: 'none' }}>(get one here)</a>
            </label>
            <input
              type="password"
              value={ollamaKey}
              onChange={(e) => setOllamaKey(e.target.value)}
              placeholder="Ollama API key..."
              style={{
                width: '100%', padding: '12px 16px', borderRadius: '10px',
                background: 'var(--haven-card)', border: '1px solid var(--haven-border)',
                color: 'var(--haven-text)', fontSize: '14px', outline: 'none',
                fontFamily: 'monospace',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px',
                  border: '1px solid var(--haven-border)', background: 'transparent',
                  color: 'var(--haven-text-secondary)', fontSize: '14px', cursor: 'pointer',
                }}
              >Back</button>
              <button
                onClick={() => { if (apiKey.trim() || ollamaKey.trim()) setStep(3); }}
                disabled={!apiKey.trim() && !ollamaKey.trim()}
                style={{
                  flex: 2, padding: '12px', borderRadius: '10px', border: 'none',
                  background: apiKey.trim() ? 'var(--haven-accent)' : 'var(--haven-border)',
                  color: 'white', fontSize: '14px', fontWeight: 600, cursor: apiKey.trim() ? 'pointer' : 'default',
                }}
              >Next</button>
            </div>
          </div>
        )}

        {/* Step 3: Description */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--haven-text)', marginBottom: '8px', textAlign: 'center' }}>
              Companion Identity
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--haven-text-muted)', textAlign: 'center', marginBottom: '24px' }}>
              This is {name ? name + "'s" : "your companion's"} personality — who they are, how they talk, what they care about. This loads on every conversation. Supports plain text, markdown, or JSON character cards.
            </p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`Who is ${name || 'your companion'}? Their personality, voice, values, boundaries, relationship to you...\n\nYou can paste an existing character card or personality doc here.`}
              rows={8}
              autoFocus
              style={{
                width: '100%', padding: '12px 16px', borderRadius: '10px',
                background: 'var(--haven-card)', border: '1px solid var(--haven-border)',
                color: 'var(--haven-text)', fontSize: '14px', outline: 'none',
                fontFamily: 'inherit', lineHeight: '1.5',
                minHeight: '120px', maxHeight: '300px',
              }}
            />
            {error && (
              <p style={{ color: '#f87171', fontSize: '12px', marginTop: '8px', textAlign: 'center' }}>{error}</p>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button
                onClick={() => setStep(2)}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px',
                  border: '1px solid var(--haven-border)', background: 'transparent',
                  color: 'var(--haven-text-secondary)', fontSize: '14px', cursor: 'pointer',
                }}
              >Back</button>
              <button
                onClick={() => setStep(4)}
                style={{
                  flex: 2, padding: '12px', borderRadius: '10px', border: 'none',
                  background: 'var(--haven-accent)', color: 'white',
                  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}
              >Next</button>
            </div>
          </div>
        )}

        {/* Step 4: Appearance */}
        {step === 4 && (
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--haven-text)', marginBottom: '8px', textAlign: 'center' }}>
              What does {name || 'your companion'} look like?
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--haven-text-muted)', textAlign: 'center', marginBottom: '24px' }}>
              Optional. Describe their physical appearance — useful for image generation if your model supports it.
            </p>
            <textarea
              value={appearance}
              onChange={(e) => setAppearance(e.target.value)}
              placeholder={`e.g. Tall, dark hair, warm brown eyes, usually wearing a soft grey sweater. Expressive hands. Slight scar on the left eyebrow...`}
              rows={6}
              autoFocus
              style={{
                width: '100%', padding: '12px 16px', borderRadius: '10px',
                background: 'var(--haven-card)', border: '1px solid var(--haven-border)',
                color: 'var(--haven-text)', fontSize: '14px', outline: 'none',
                fontFamily: 'inherit', lineHeight: '1.5',
                minHeight: '100px', maxHeight: '250px',
              }}
            />
            {error && (
              <p style={{ color: '#f87171', fontSize: '12px', marginTop: '8px', textAlign: 'center' }}>{error}</p>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button
                onClick={() => setStep(3)}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px',
                  border: '1px solid var(--haven-border)', background: 'transparent',
                  color: 'var(--haven-text-secondary)', fontSize: '14px', cursor: 'pointer',
                }}
              >Back</button>
              <button
                onClick={handleFinish}
                disabled={saving}
                style={{
                  flex: 2, padding: '12px', borderRadius: '10px', border: 'none',
                  background: 'var(--haven-accent)', color: 'white',
                  fontSize: '14px', fontWeight: 600, cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
              >{saving ? 'Setting up...' : 'Finish'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
