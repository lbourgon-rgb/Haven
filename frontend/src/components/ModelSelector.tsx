import { useState, useEffect, useRef } from 'react';
import type { ModelInfo } from '../lib/types';
import { getModels } from '../lib/api';

interface ModelSelectorProps {
  selectedModel: string;
  selectedProvider: string;
  onModelChange: (model: string, provider: string) => void;
}

function tierBadge(tier: string) {
  const colors: Record<string, { bg: string; text: string }> = {
    free: { bg: '#16a34a22', text: '#4ade80' },
    paid: { bg: '#d4748a22', text: '#E8A4B8' },
    local: { bg: '#3b82f622', text: '#60a5fa' },
  };
  const c = colors[tier] || colors.paid;
  return (
    <span style={{
      fontSize: '9px', fontWeight: 600, textTransform: 'uppercase',
      background: c.bg, color: c.text, borderRadius: '4px', padding: '1px 5px',
      marginLeft: '6px',
    }}>{tier}</span>
  );
}

export default function ModelSelector({ selectedModel, selectedProvider, onModelChange }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [hoveredModel, setHoveredModel] = useState<ModelInfo | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getModels().then(setModels).catch(() => {});
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Group by provider
  const grouped: Record<string, ModelInfo[]> = {};
  for (const m of models) {
    (grouped[m.provider] ??= []).push(m);
  }

  const current = models.find((m) => m.id === selectedModel && m.provider === selectedProvider);
  const displayName = current?.name || selectedModel || 'Select model';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          background: 'var(--haven-card)', border: '1px solid var(--haven-border)',
          borderRadius: '8px', padding: '4px 10px', fontSize: '12px',
          color: 'var(--haven-text-secondary)', cursor: 'pointer',
          maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" style={{ flexShrink: 0 }}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div
          className="hide-scrollbar"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '4px',
            background: 'var(--haven-surface)', border: '1px solid var(--haven-border)',
            borderRadius: '10px', minWidth: '220px', maxHeight: '300px', overflowY: 'auto',
            zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {Object.entries(grouped).map(([provider, providerModels]) => (
            <div key={provider}>
              <div style={{
                padding: '8px 12px 4px', fontSize: '10px', fontWeight: 600,
                color: 'var(--haven-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>{provider}</div>
              {providerModels.map((m) => (
                <div key={`${m.provider}-${m.id}`} style={{ position: 'relative' }}>
                  <button
                    onClick={() => { onModelChange(m.id, m.provider); setOpen(false); setHoveredModel(null); }}
                    onMouseEnter={(e) => {
                      if (m.id !== selectedModel) e.currentTarget.style.background = 'var(--haven-card)';
                      if (m.description || m.context_length) setHoveredModel(m);
                    }}
                    onMouseLeave={(e) => {
                      if (m.id !== selectedModel || m.provider !== selectedProvider) e.currentTarget.style.background = 'transparent';
                      setHoveredModel(null);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', width: '100%',
                      padding: '6px 12px', background: (m.id === selectedModel && m.provider === selectedProvider) ? 'var(--haven-card)' : 'transparent',
                      border: 'none', color: 'var(--haven-text)', fontSize: '12px',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                    {tierBadge(m.tier)}
                  </button>
                  {hoveredModel?.id === m.id && hoveredModel?.provider === m.provider && (
                    <div style={{
                      position: 'absolute', right: '100%', top: 0, marginRight: '8px',
                      background: 'var(--haven-bg)', border: '1px solid var(--haven-border)',
                      borderRadius: '8px', padding: '10px 12px', width: '220px',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 110,
                      pointerEvents: 'none',
                    }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--haven-text)', marginBottom: '4px' }}>{m.name}</div>
                      {m.context_length && (
                        <div style={{ fontSize: '10px', color: 'var(--haven-accent)', marginBottom: '4px' }}>
                          {m.context_length >= 1000000
                            ? `${(m.context_length / 1000000).toFixed(1)}M context`
                            : `${Math.round(m.context_length / 1000)}K context`}
                        </div>
                      )}
                      {m.description && (
                        <div style={{ fontSize: '10px', color: 'var(--haven-text-muted)', lineHeight: '1.4', maxHeight: '80px', overflow: 'hidden' }}>
                          {m.description.length > 200 ? m.description.slice(0, 200) + '...' : m.description}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {models.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--haven-text-muted)', fontSize: '12px' }}>
              No models available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
